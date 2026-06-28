import fs from 'node:fs/promises';
import path from 'node:path';
import {
  AuthModes,
  EventTypes,
  type LaunchAuth,
  type LaunchComposition,
  type LaunchExit,
  type MinecraftKitErrorCode,
  MinecraftKitErrorCodes,
  asAzureClientId,
  asPlayerUuid,
  isMinecraftKitError,
  toOnlineAuth,
} from '@loontail/minecraft-kit';
import {
  AUTHLIB_INJECTOR_VERSION,
  buildAuthlibInjectorJvmArg,
  resolveAuthlibInjectorJarPath,
} from '@loontail/yggdrasil-client';
import { dashUuid } from '@loontail/yggdrasil-core';
import { mainConfig } from '@main/config';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, getStoredSessionToken, recordPlayed } from '@main/infra/store';
import type { Account } from '@shared/contracts/account';
import type { AuthSession } from '@shared/contracts/auth';
import { ConsoleSources, ConsoleStatuses } from '@shared/contracts/console';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { app } from 'electron';
import type { Context } from './context';
import type { ManagerEnv } from './env';
import { ManagerError, classifyError } from './errors';
import { type LaunchStartingOp, OpKinds } from './ops';

const launchLogger = scopedLogger('minecraft.launch');

// Zero GUID to satisfy the kit's OnlineAuth shape for Yggdrasil sessions;
// authlib-injector intercepts the authlib calls so the game never contacts Microsoft.
const YGGDRASIL_PLACEHOLDER_CLIENT_ID = asAzureClientId('00000000-0000-0000-0000-000000000000');
// Cloudflare blocks authlib-injector's bare `Java/...` UA, so give it a launcher UA.
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

// compose reads only from disk, so a MinecraftKitError here means an incomplete
// install — reclassify so the renderer offers Repair, not a raw error.
const toComposeFailure = (error: unknown): unknown => {
  if (isLaunchPreflightError(error)) return error;
  if (!isMinecraftKitError(error)) return error;
  const code = RUNTIME_REPAIR_KIT_CODES.has(error.code)
    ? MinecraftErrorCodes.RUNTIME_ERROR
    : MinecraftErrorCodes.NOT_INSTALLED;
  return new LaunchPreflightError(code, errorMessage(error));
};

// The full launch command is logged to disk, so redact the session bearer it
// embeds (-Dloontail.network.serviceToken=) before it ever hits the log file.
const SERVICE_TOKEN_PROP = '-Dloontail.network.serviceToken=';
const redactServiceToken = (command: string): string =>
  command.replace(/-Dloontail\.network\.serviceToken=\S+/g, `${SERVICE_TOKEN_PROP}<redacted>`);

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

const LOONTAIL_AGENT_JAR = 'loontail-network-agent.jar';

// The agent jar is built `--release 21`, so attaching it via `-javaagent` on an
// older JVM (Java 8/17) would abort startup. Only attach on Java 21+.
const NETWORK_AGENT_MIN_JAVA = 21;

const resolveNetworkAgentJar = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'loontail-agent', LOONTAIL_AGENT_JAR)
    : path.join(app.getAppPath(), 'resources', 'agent', LOONTAIL_AGENT_JAR);

// JVM args that attach the in-game network agent, or [] when it must not attach.
// The overlay is strictly best-effort: a wrong Java or missing jar never blocks launch.
const buildNetworkAgentJvmArgs = async (
  slug: CatalogKey,
  javaMajor: number | undefined,
): Promise<readonly string[]> => {
  if (javaMajor === undefined || javaMajor < NETWORK_AGENT_MIN_JAVA) {
    launchLogger.info(
      `[${slug}] launch: network agent not attached (Java ${javaMajor ?? '?'} < ${NETWORK_AGENT_MIN_JAVA})`,
    );
    return [];
  }
  try {
    const jarPath = resolveNetworkAgentJar();
    await fs.access(jarPath);
    const args = [`-javaagent:${jarPath}`];
    if (mainConfig.networkServiceUrl) {
      args.push(`-Dloontail.network.serviceUrl=${mainConfig.networkServiceUrl}`);
    }
    // Hand the agent the same session token so it authenticates as this user.
    // Known leak: the token rides on a `-D` property, readable in the local
    // process list. Moving it off `-D` needs a coordinated agent change and is
    // tracked for a follow-up; the on-disk log leak is closed by redactServiceToken.
    const sessionToken = getStoredSessionToken();
    if (sessionToken) {
      args.push(`-Dloontail.network.serviceToken=${sessionToken}`);
    }
    return args;
  } catch (error) {
    launchLogger.warn(`[${slug}] launch: network agent not attached (${errorMessage(error)})`);
    return [];
  }
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

// compose already gated the version JSON, so only the runtime and classpath
// (which holds the executable jar) remain to check here.
const verifyLaunchPreflight = async (composition: LaunchComposition): Promise<void> => {
  await requireLaunchFile(
    composition.javaPath,
    'Java executable',
    MinecraftErrorCodes.RUNTIME_ERROR,
  );

  if (composition.classpath.length === 0) {
    throw new LaunchPreflightError(
      MinecraftErrorCodes.NOT_INSTALLED,
      'Launch preflight failed: classpath is empty',
    );
  }
  // Fan the fs.access checks out: a Forge classpath can hold 100+ jars and a
  // sequential walk adds visible cold-disk latency. Promise.all fails fast on first miss.
  await Promise.all(
    composition.classpath.map((classpathFile) => {
      // fs.access('') would resolve against the CWD and silently pass, masking a
      // malformed version JSON.
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

// Lift the OS exit code the kit carries on a LAUNCH_PROCESS_FAILED error onto the
// console state — it's the first crash-triage signal (e.g. -1073741819 = access violation).
const launchExitCode = (error: unknown): number | null => {
  if (isMinecraftKitError(error) && typeof error.context.exitCode === 'number') {
    return error.context.exitCode;
  }
  return null;
};

export const endLaunch = (
  env: ManagerEnv,
  slug: CatalogKey,
  error?: unknown,
  exit?: LaunchExit,
): void => {
  env.ops.delete(slug);
  // Flush the log4j parser before the terminal state so a crash event split
  // across the final lines is ingested, not dropped.
  env.console.endSession(slug);
  if (error) {
    const message = errorMessage(error);
    env.logger.error(`[${slug}] launch: game process failed — ${message}`, error);
    env.emitError(slug, classifyError(error), message);
    env.console.emitState({
      slug,
      status: ConsoleStatuses.CRASHED,
      message,
      exitCode: launchExitCode(error),
    });
    env.console.recordSystem(`Process crashed: ${message}`, {
      code: 'console.system.processCrashedWithMessage',
      args: { detail: message },
      slug,
    });
    // Surface crash details even if auto-open is off — user needs the backlog.
    if (!env.console.hasWindow()) env.openConsole();
  } else {
    // The kit resolves `exited` for both a clean exit and a user stop; only the
    // latter sets `aborted`.
    env.logger.info(`[${slug}] launch: game ${exit?.aborted ? 'stopped' : 'exited'}`);
    env.console.emitState({ slug, status: ConsoleStatuses.EXITED, exitCode: exit?.code ?? null });
    env.console.recordSystem('Process exited', {
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

// Pick the kit's auth shape per session: Yggdrasil runs ONLINE with authlib-injector
// pointed at the launcher's Yggdrasil server, Mojang passes the Microsoft session
// through unchanged, no session → offline.
export const resolveLaunchAuth = (
  account: Account,
  session: AuthSession | null,
): ResolvedLaunchAuth => {
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
  slug: CatalogKey,
  ctx: Context,
  account: Account,
  // Reuse the caller's LAUNCH_STARTING op so a Stop during buildContext aborts
  // this exact controller; minting a fresh one would drop the cancel and spawn
  // anyway. Defaults to a fresh op for the bundle path.
  startupOp: LaunchStartingOp = { kind: OpKinds.LAUNCH_STARTING, abort: new AbortController() },
): Promise<void> => {
  const startupSignal = startupOp.abort.signal;
  const restoreInstalled = (): void => {
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
  };

  env.ops.set(slug, startupOp);
  env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
  try {
    const resolved = resolveLaunchAuth(account, getStoredAuth());
    if (resolved.extraJvmArgs.length > 0) {
      launchLogger.info(`[${slug}] launch: injecting authlib-injector (yggdrasil session)`);
    }
    const networkAgentArgs = await buildNetworkAgentJvmArgs(slug, ctx.target.runtime.majorVersion);
    if (networkAgentArgs.length > 0) {
      launchLogger.info(`[${slug}] launch: attaching Loontail network agent (in-game overlay)`);
    }
    const extraJvmArgs = [...resolved.extraJvmArgs, ...networkAgentArgs];
    let composition: LaunchComposition;
    try {
      composition = await env.kit.launch.compose(ctx.target, {
        auth: resolved.auth,
        ...(extraJvmArgs.length > 0 ? { extraJvmArgs } : {}),
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
    await verifyLaunchPreflight(composition);
    if (startupSignal.aborted) {
      restoreInstalled();
      return;
    }
    const consoleEnabled = ctx.resolved.launch.console;
    const clientTitle = ctx.item.presentation.title || slug;
    env.console.setActiveSession({
      slug,
      clientTitle,
      state: { slug, status: ConsoleStatuses.LAUNCHING, clientTitle },
    });
    env.console.emitState({ slug, status: ConsoleStatuses.LAUNCHING, clientTitle });
    env.console.recordSystem('Launching…', { code: 'console.system.launching', slug });
    if (consoleEnabled) env.openConsole();
    const session = env.kit.launch.run(composition, {
      signal: startupSignal,
      onEvent: (event) => {
        switch (event.type) {
          case EventTypes.LAUNCH_STARTING:
            env.logger.info(
              `[${slug}] launch: starting ${redactServiceToken(event.command)} (cwd ${event.cwd})`,
            );
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
            env.console.recordMinecraft(slug, stream, event.line);
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
    env.ops.set(slug, { kind: OpKinds.LAUNCH, session });
    // Observe termination before any post-spawn bookkeeping that could throw, else
    // a failure below leaves the process unobserved or the LAUNCH op stranded
    // (bricking the slug via requireIdle). The trailing .catch guards endLaunch.
    void session.exited
      .then((exit) => {
        endLaunch(env, slug, undefined, exit);
      })
      .catch((error: unknown) => {
        endLaunch(env, slug, error);
      })
      .catch((error: unknown) => {
        env.logger.error(`[${slug}] endLaunch threw`, error);
      });

    // Stamp Home recents keyed by the resolved CatalogKey (not the operational
    // slug) so the renderer matches it against the catalog. Best-effort.
    try {
      recordPlayed(ctx.item.key);
    } catch (error) {
      env.logger.warn(`[${slug}] failed to record last-played`, error);
    }
    env.emitStatus({ slug, status: InstallStatuses.RUNNING, paused: false });
    env.console.emitState({ slug, status: ConsoleStatuses.RUNNING, clientTitle });
    env.console.recordSystem('Process started', {
      code: 'console.system.processStarted',
      slug,
    });
  } catch (error) {
    if (startupSignal.aborted) {
      restoreInstalled();
      return;
    }
    if (isLaunchPreflightError(error)) {
      const message = errorMessage(error);
      launchLogger.warn(`[${slug}] launch preflight failed - ${message}`, error);
      // Keep the client INSTALLED (affordance stays "Play"); the renderer turns the
      // error event into a repair toast rather than us silently reinstalling.
      env.console.recordSystem(`Launch check failed: ${message}`, { slug });
      if (!env.console.hasWindow()) env.openConsole();
      env.emitError(slug, error.code, message);
      env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
      return;
    }
    env.logger.error(`[${slug}] launch failed`, error);
    env.emitError(slug, classifyError(error, startupSignal), errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
    const message = errorMessage(error);
    env.console.emitState({ slug, status: ConsoleStatuses.ERROR, message });
    env.console.recordSystem(`Process error: ${message}`, { slug });
    if (!env.console.hasWindow()) env.openConsole();
    // Already surfaced via emitError; re-throwing would double-surface it as an
    // IPC rejection (second toast) plus an error-level handler log.
  } finally {
    if (env.ops.get(slug) === startupOp) env.ops.delete(slug);
  }
};

export const requireAccount = (account: Account | null): Account => {
  if (account) return account;
  throw new ManagerError(MinecraftErrorCodes.NO_ACCOUNT, 'Sign in before launching');
};
