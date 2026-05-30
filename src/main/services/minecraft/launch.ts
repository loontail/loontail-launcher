import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AuthModes,
  EventTypes,
  type LaunchAuth,
  type LaunchComposition,
  type MinecraftKitErrorCode,
  MinecraftKitErrorCodes,
  asAzureClientId,
  asPlayerUuid,
  isMinecraftKitError,
  resolveLaunchVersion,
  targetPaths,
  toOnlineAuth,
} from '@loontail/minecraft-kit';
import {
  AUTHLIB_INJECTOR_VERSION,
  buildAuthlibInjectorJvmArg,
  resolveAuthlibInjectorJarPath,
} from '@loontail/yggdrasil-client';
import { dashUuid } from '@loontail/yggdrasil-core';
import { mainConfig } from '@main/config';
import { consoleHub } from '@main/infra/consoleHub';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth } from '@main/infra/store';
import { openConsoleWindow } from '@main/windows/consoleWindow';
import type { Account } from '@shared/contracts/account';
import { ConsoleSources, ConsoleStatuses } from '@shared/contracts/console';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { app } from 'electron';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { ManagerError, classifyError } from './errors';
import { type LaunchStartingOp, OpKinds } from './ops';

const launchLogger = scopedLogger('minecraft.launch');

// Placeholder Azure AD client id used to satisfy the kit's `OnlineAuth` shape
// for Yggdrasil sessions. authlib-injector intercepts the Mojang authlib calls
// at JVM init, so the game never contacts Microsoft — but the kit still
// validates the field shape, hence a real-looking zero GUID.
const YGGDRASIL_PLACEHOLDER_CLIENT_ID = asAzureClientId('00000000-0000-0000-0000-000000000000');
// authlib-injector fetches metadata with Java's default URLConnection UA.
// Cloudflare blocks bare `Java/...`, so give that JVM traffic a launcher UA.
const YGGDRASIL_HTTP_AGENT_NAME = 'LoontailLauncher';

class LaunchPreflightError extends ManagerError {}

const isLaunchPreflightError = (error: unknown): error is LaunchPreflightError =>
  error instanceof LaunchPreflightError;

// Kit error codes that point at the Java runtime rather than the game files.
const RUNTIME_REPAIR_KIT_CODES: ReadonlySet<MinecraftKitErrorCode> = new Set([
  MinecraftKitErrorCodes.RUNTIME_NOT_FOUND,
  MinecraftKitErrorCodes.RUNTIME_UNSUPPORTED_PLATFORM,
  MinecraftKitErrorCodes.LAUNCH_JAVA_NOT_FOUND,
]);

// `kit.launch.compose` assembles the launch purely from on-disk files (the
// installed version JSON, libraries, runtime) — it does not hit the network. A
// MinecraftKitError thrown here therefore means the install is incomplete (e.g.
// MANIFEST_NOT_FOUND = "no installed version JSON on disk"), not a transient
// network failure. Reclassify it as a repairable launch-preflight failure so the
// catch path keeps the client INSTALLED and the renderer offers a Repair toast,
// instead of surfacing a raw, non-repairable error. Non-kit errors pass through
// to the generic launch-failure branch.
const toComposeFailure = (error: unknown): unknown => {
  if (isLaunchPreflightError(error)) return error;
  if (!isMinecraftKitError(error)) return error;
  const code = RUNTIME_REPAIR_KIT_CODES.has(error.code)
    ? MinecraftErrorCodes.RUNTIME_ERROR
    : MinecraftErrorCodes.NOT_INSTALLED;
  return new LaunchPreflightError(code, errorMessage(error));
};

const sanitizeHttpAgentToken = (value: string): string => {
  const token = value.trim().replace(/[^0-9A-Za-z.+_-]/g, '-');
  return token.length > 0 ? token : 'dev';
};

const buildYggdrasilHttpAgentJvmArg = (): string =>
  `-Dhttp.agent=${YGGDRASIL_HTTP_AGENT_NAME}/${sanitizeHttpAgentToken(app.getVersion())}`;

const resolveAuthlibInjectorJar = (): string => {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      'authlib-injector',
      `authlib-injector-${AUTHLIB_INJECTOR_VERSION}.jar`,
    );
  }
  return resolveAuthlibInjectorJarPath();
};

const requireLaunchFile = async (
  filePath: string,
  label: string,
  code: typeof MinecraftErrorCodes.RUNTIME_ERROR | typeof MinecraftErrorCodes.NOT_INSTALLED,
): Promise<void> => {
  try {
    await fs.access(filePath);
  } catch {
    throw new LaunchPreflightError(code, `Launch preflight failed: missing ${label}: ${filePath}`);
  }
};

const verifyLaunchPreflight = async (
  ctx: Context,
  composition: LaunchComposition,
): Promise<void> => {
  await requireLaunchFile(
    composition.javaPath,
    'Java executable',
    MinecraftErrorCodes.RUNTIME_ERROR,
  );

  let versionId = ctx.target.minecraft.version;
  try {
    versionId = (await resolveLaunchVersion(ctx.target)).versionId;
  } catch (error) {
    throw new LaunchPreflightError(MinecraftErrorCodes.NOT_INSTALLED, errorMessage(error));
  }

  await requireLaunchFile(
    targetPaths.versionJson(ctx.target.directory, versionId),
    'version JSON',
    MinecraftErrorCodes.NOT_INSTALLED,
  );
  await requireLaunchFile(
    targetPaths.versionJar(ctx.target.directory, ctx.target.minecraft.version),
    'client jar',
    MinecraftErrorCodes.NOT_INSTALLED,
  );

  if (composition.classpath.length === 0) {
    throw new LaunchPreflightError(
      MinecraftErrorCodes.NOT_INSTALLED,
      'Launch preflight failed: classpath is empty',
    );
  }
  // Classpath entries are independent, so fan the fs.access checks out — a Forge
  // classpath can hold 100+ jars and a sequential walk adds visible launch
  // latency on a cold disk. Promise.all still fails fast on the first miss.
  await Promise.all(
    composition.classpath.map((classpathFile) => {
      // An empty entry would make fs.access('') resolve against the CWD and
      // silently pass, masking a malformed version JSON.
      if (!classpathFile) {
        throw new LaunchPreflightError(
          MinecraftErrorCodes.NOT_INSTALLED,
          'Launch preflight failed: classpath contains an empty entry',
        );
      }
      return requireLaunchFile(classpathFile, 'classpath file', MinecraftErrorCodes.NOT_INSTALLED);
    }),
  );
};

export const endLaunch = (env: ManagerEnv, slug: ClientSlug, error?: unknown): void => {
  env.ops.delete(slug);
  if (error) {
    const message = errorMessage(error);
    env.logger.error(`[${slug}] launch: game process failed — ${message}`, error);
    env.emitError(slug, classifyError(error), message);
    consoleHub.emitState({ slug, status: ConsoleStatuses.CRASHED, message });
    consoleHub.recordSystem(`Process crashed: ${message}`, {
      code: 'console.system.processCrashedWithMessage',
      args: { detail: message },
      slug,
    });
    // Surface crash details even if auto-open is off — user needs the backlog.
    if (!consoleHub.hasWindow()) openConsoleWindow();
  } else {
    env.logger.info(`[${slug}] launch: game exited`);
    consoleHub.emitState({ slug, status: ConsoleStatuses.EXITED, exitCode: null });
    consoleHub.recordSystem('Process exited', {
      code: 'console.system.processExited',
      slug,
    });
  }
  env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
};

type ResolvedLaunchAuth = {
  readonly auth: LaunchAuth;
  readonly extraJvmArgs: readonly string[];
};

// Pick the kit's auth shape based on the active session. Yggdrasil sessions
// run the game in ONLINE mode using the Yggdrasil-issued access token, with a
// `-javaagent` JVM arg pointing the JVM at authlib-injector so the game's
// own auth/profile calls hit the launcher's Yggdrasil server. Mojang sessions
// pass the upstream Microsoft session through unchanged. No session → offline.
const resolveLaunchAuth = (account: Account): ResolvedLaunchAuth => {
  const session = getStoredAuth();
  if (session?.provider === 'mojang') {
    return {
      auth: toOnlineAuth({
        minecraft: {
          username: session.profile.username,
          uuid: session.profile.uuid,
          accessToken: session.accessToken,
          expiresAt: session.expiresAt,
          xuid: session.xuid,
          skins: session.profile.skins,
        },
        microsoft: {
          refreshToken: session.refreshToken,
          clientId: session.clientId,
        },
      }),
      extraJvmArgs: [],
    };
  }
  if (session?.provider === 'yggdrasil') {
    const jarPath = resolveAuthlibInjectorJar();
    return {
      auth: {
        mode: AuthModes.ONLINE,
        username: session.profile.name,
        uuid: asPlayerUuid(dashUuid(session.profile.uuid)),
        accessToken: session.accessToken,
        userType: 'msa',
        clientId: YGGDRASIL_PLACEHOLDER_CLIENT_ID,
        xuid: '',
      },
      extraJvmArgs: [
        buildYggdrasilHttpAgentJvmArg(),
        buildAuthlibInjectorJvmArg({ jarPath, apiRoot: mainConfig.yggdrasilApiRoot }),
      ],
    };
  }
  return {
    auth: { mode: AuthModes.OFFLINE, username: account.username },
    extraJvmArgs: [],
  };
};

export const runLaunch = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  account: Account,
): Promise<void> => {
  const startupOp: LaunchStartingOp = {
    kind: OpKinds.LAUNCH_STARTING,
    abort: new AbortController(),
  };
  const startupSignal = startupOp.abort.signal;
  const restoreInstalled = (): void => {
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  };

  env.ops.set(slug, startupOp);
  env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
  try {
    const resolved = resolveLaunchAuth(account);
    if (resolved.extraJvmArgs.length > 0) {
      launchLogger.info(`[${slug}] launch: injecting authlib-injector (yggdrasil session)`);
    }
    let composition: LaunchComposition;
    try {
      composition = await env.kit.launch.compose(ctx.target, {
        auth: resolved.auth,
        ...(resolved.extraJvmArgs.length > 0 ? { extraJvmArgs: resolved.extraJvmArgs } : {}),
        ...(ctx.resolved.memory.allocatedRamMb > 0
          ? { memory: { maxMb: ctx.resolved.memory.allocatedRamMb } }
          : {}),
        fullscreen: ctx.resolved.launch.fullscreen,
        launcherName: 'loontail',
        launcherVersion: app.getVersion(),
      });
    } catch (error) {
      if (startupSignal.aborted) {
        restoreInstalled();
        return;
      }
      throw toComposeFailure(error);
    }
    if (startupSignal.aborted) {
      restoreInstalled();
      return;
    }
    await verifyLaunchPreflight(ctx, composition);
    if (startupSignal.aborted) {
      restoreInstalled();
      return;
    }
    const consoleEnabled = ctx.resolved.launch.console;
    const clientTitle = ctx.client.title || slug;
    consoleHub.setActiveSession({
      slug,
      clientTitle,
      state: { slug, status: ConsoleStatuses.LAUNCHING, clientTitle },
    });
    consoleHub.emitState({ slug, status: ConsoleStatuses.LAUNCHING, clientTitle });
    consoleHub.recordSystem('Launching…', { code: 'console.system.launching', slug });
    if (consoleEnabled) openConsoleWindow();
    const session = env.kit.launch.run(composition, {
      signal: startupSignal,
      onEvent: (event) => {
        switch (event.type) {
          case EventTypes.LAUNCH_STARTING:
            env.logger.info(`[${slug}] launch: starting ${event.command} (cwd ${event.cwd})`);
            return;
          case EventTypes.LAUNCH_STARTED:
            env.logger.info(`[${slug}] launch: started pid=${event.pid}`);
            return;
          case EventTypes.LAUNCH_EXITED:
            env.logger.info(
              `[${slug}] launch: exited code=${event.code ?? 'null'} signal=${event.signal ?? 'null'}`,
            );
            return;
          case EventTypes.LAUNCH_ABORTED:
            env.logger.info(`[${slug}] launch: aborted (${event.reason})`);
            return;
          case EventTypes.LAUNCH_STDOUT:
          case EventTypes.LAUNCH_STDERR: {
            const stream =
              event.type === EventTypes.LAUNCH_STDOUT
                ? ConsoleSources.STDOUT
                : ConsoleSources.STDERR;
            consoleHub.recordMinecraft(slug, stream, event.line);
            // Keep the legacy `minecraft.log` IPC event for external subscribers.
            if (consoleEnabled) {
              env.broadcaster.log({ slug, stream, line: event.line });
            }
            return;
          }
          default:
            return;
        }
      },
    });
    if (startupSignal.aborted) {
      session.abort('user-stop');
      restoreInstalled();
      return;
    }
    env.ops.set(slug, { kind: OpKinds.LAUNCH, session, consoleEnabled });
    env.emitStatus({ slug, status: InstallStatuses.RUNNING, paused: false });
    consoleHub.emitState({ slug, status: ConsoleStatuses.RUNNING, clientTitle });
    consoleHub.recordSystem('Process started', {
      code: 'console.system.processStarted',
      slug,
    });

    // Kit rejects session.exited on non-zero exit; trailing .catch guards
    // against endLaunch itself throwing.
    void session.exited
      .then(() => {
        endLaunch(env, slug);
      })
      .catch((error: unknown) => {
        endLaunch(env, slug, error);
      })
      .catch((error: unknown) => {
        env.logger.error(`[${slug}] endLaunch threw`, error);
      });
  } catch (error) {
    if (startupSignal.aborted) {
      restoreInstalled();
      return;
    }
    if (isLaunchPreflightError(error)) {
      const message = errorMessage(error);
      launchLogger.warn(`[${slug}] launch preflight failed - ${message}`, error);
      // Surface the failed check in the console and keep the client INSTALLED so
      // the affordance stays "Play". The renderer turns the error event into a
      // toast offering a repair — we do not silently reinstall here.
      consoleHub.recordSystem(`Launch check failed: ${message}`, { slug });
      if (!consoleHub.hasWindow()) openConsoleWindow();
      env.emitError(slug, error.code, message);
      env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
      return;
    }
    env.logger.error(`[${slug}] launch failed`, error);
    env.emitError(slug, classifyError(error, startupSignal), errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
    const message = errorMessage(error);
    consoleHub.emitState({ slug, status: ConsoleStatuses.ERROR, message });
    consoleHub.recordSystem(`Process error: ${message}`, { slug });
    if (!consoleHub.hasWindow()) openConsoleWindow();
    throw error;
  } finally {
    if (env.ops.get(slug) === startupOp) env.ops.delete(slug);
  }
};

export const requireAccount = (account: Account | null): Account => {
  if (account) return account;
  throw new ManagerError(MinecraftErrorCodes.NO_ACCOUNT, 'Sign in before launching');
};
