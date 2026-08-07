import fs from 'node:fs/promises';
import {
  AuthModes,
  asAzureClientId,
  asPlayerUuid,
  EventTypes,
  isMinecraftKitError,
  type LaunchAuth,
  type LaunchComposition,
  type LaunchExit,
  type MinecraftKitErrorCode,
  MinecraftKitErrorCodes,
  toOnlineAuth,
} from '@loontail/minecraft-kit';
import { mainConfig } from '@main/config';
import { errorMessage } from '@main/infra/errorMessage';
import { scopedLogger } from '@main/infra/logger';
import { getStoredAuth, getStoredSessionToken, recordPlayed } from '@main/infra/store';
import {
  buildAuthlibInjectorJvmArg,
  resolveAuthlibInjectorJarPath,
} from '@main/services/yggdrasil/authlibInjector';
import type { Account } from '@shared/contracts/account';
import type { AuthSession } from '@shared/contracts/auth';
import { type CatalogItem, SourceKinds } from '@shared/contracts/catalog';
import { ConsoleSources, ConsoleStatuses } from '@shared/contracts/console';
import type { CatalogKey } from '@shared/contracts/ids';
import { InstallStatuses, MinecraftErrorCodes } from '@shared/contracts/minecraft';
import { dashUuid } from '@shared/yggdrasil/uuid';
import { app } from 'electron';
import type { Context } from './context';
import type { MinecraftEnv } from './env';
import { classifyError, MinecraftError } from './errors';
import { type LaunchStartingOp, OpKinds } from './ops';

const launchLogger = scopedLogger('minecraft.launch');

// Zero GUID to satisfy the kit's OnlineAuth shape for Yggdrasil sessions;
// authlib-injector intercepts the authlib calls so the game never contacts Microsoft.
const YGGDRASIL_PLACEHOLDER_CLIENT_ID = asAzureClientId('00000000-0000-0000-0000-000000000000');
// Cloudflare blocks authlib-injector's bare `Java/...` UA, so give it a launcher UA.
const YGGDRASIL_HTTP_AGENT_NAME = 'LoontailLauncher';

class LaunchPreflightError extends MinecraftError {}

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

const sanitizeHttpAgentToken = (value: string): string => {
  const token = value.trim().replace(/[^0-9A-Za-z.+_-]/g, '-');
  return token.length > 0 ? token : 'dev';
};

const buildYggdrasilHttpAgentJvmArg = (): string =>
  `-Dhttp.agent=${YGGDRASIL_HTTP_AGENT_NAME}/${sanitizeHttpAgentToken(app.getVersion())}`;

// The env var the in-game network mod reads the session token from.
const SERVICE_TOKEN_ENV = 'LOONTAIL_NETWORK_SERVICE_TOKEN';

type NetworkOverlayConfig = {
  // Non-secret -D props the network mod reads from the game JVM.
  readonly jvmArgs: readonly string[];
  // Env vars to set on the spawned game process. The session token rides here, NOT
  // on a -D arg, so it never appears in the OS process list.
  readonly env: Readonly<Record<string, string>>;
};

const EMPTY_NETWORK_OVERLAY: NetworkOverlayConfig = { jvmArgs: [], env: {} };

// Service URL and session token handed to the in-game network mod. The token is
// the full API bearer and ANY class in the game JVM can read it via
// System.getenv, so it is gated exactly like the URL: no NETWORK_API_URL means
// in-game networking is switched off and nothing is handed over. LOCAL builds
// run user-supplied loose mods the launcher never vetted, so they never get the
// bearer either — the managed overlay that ships the network mod is
// official-only (see MinecraftManager.bundleHookFor).
const buildNetworkOverlayConfig = (item: CatalogItem): NetworkOverlayConfig => {
  if (!mainConfig.networkServiceUrl) return EMPTY_NETWORK_OVERLAY;
  const jvmArgs = [`-Dloontail.network.serviceUrl=${mainConfig.networkServiceUrl}`];
  if (item.kind === SourceKinds.LOCAL) return { jvmArgs, env: {} };
  const sessionToken = getStoredSessionToken();
  return { jvmArgs, env: sessionToken ? { [SERVICE_TOKEN_ENV]: sessionToken } : {} };
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
  env: MinecraftEnv,
  key: CatalogKey,
  error?: unknown,
  exit?: LaunchExit,
): void => {
  env.ops.delete(key);
  // Flush the log4j parser before the terminal state so a crash event split
  // across the final lines is ingested, not dropped.
  env.console.endSession(key);
  if (error) {
    const message = errorMessage(error);
    env.logger.error(`[${key}] launch: game process failed — ${message}`, error);
    env.emitError(key, classifyError(error), message);
    env.console.emitState({
      key,
      status: ConsoleStatuses.CRASHED,
      message,
      exitCode: launchExitCode(error),
    });
    env.console.recordSystem(`Process crashed: ${message}`, {
      code: 'console.system.processCrashedWithMessage',
      args: { detail: message },
      key,
    });
    // Surface crash details even if auto-open is off — user needs the backlog.
    if (!env.console.hasWindow()) env.openConsole();
  } else {
    // The kit resolves `exited` for both a clean exit and a user stop; only the
    // latter sets `aborted`.
    env.logger.info(`[${key}] launch: game ${exit?.aborted ? 'stopped' : 'exited'}`);
    env.console.emitState({ key, status: ConsoleStatuses.EXITED, exitCode: exit?.code ?? null });
    env.console.recordSystem('Process exited', {
      code: 'console.system.processExited',
      key,
    });
  }
  env.emitStatus({ key, status: InstallStatuses.INSTALLED, paused: false });
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
    const jarPath = resolveAuthlibInjectorJarPath();
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
  env: MinecraftEnv,
  key: CatalogKey,
  ctx: Context,
  account: Account,
  // Reuse the caller's LAUNCH_STARTING op so a Stop during buildContext aborts
  // this exact controller; minting a fresh one would drop the cancel and spawn
  // anyway. Defaults to a fresh op for the bundle path.
  startupOp: LaunchStartingOp = { kind: OpKinds.LAUNCH_STARTING, abort: new AbortController() },
): Promise<void> => {
  const startupSignal = startupOp.abort.signal;
  const restoreInstalled = (): void => {
    env.emitStatus({ key, status: InstallStatuses.INSTALLED, paused: false });
  };

  env.ops.set(key, startupOp);
  env.emitStatus({ key, status: InstallStatuses.LAUNCHING, paused: false });
  try {
    const resolved = resolveLaunchAuth(account, getStoredAuth());
    if (resolved.extraJvmArgs.length > 0) {
      launchLogger.info(`[${key}] launch: injecting authlib-injector (yggdrasil session)`);
    }
    const networkOverlay = buildNetworkOverlayConfig(ctx.item);
    const extraJvmArgs = [...resolved.extraJvmArgs, ...networkOverlay.jvmArgs];
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
      throw toComposeFailure(error);
    }
    // Merge the overlay env (the session token for the network mod) into the
    // composition so the kit's spawner sets it on the child JVM. The default
    // ChildProcessSpawner merges this over process.env, so the rest of the
    // environment is preserved.
    if (Object.keys(networkOverlay.env).length > 0) {
      composition = {
        ...composition,
        env: { ...composition.env, ...networkOverlay.env },
      };
    }
    // One rule, one place: a Stop anywhere during startup settles back to
    // INSTALLED and emits nothing. throwIfAborted routes it to the outer catch,
    // whose abort branch is byte-identical — so a newly inserted await between
    // these points cannot silently lose its checkpoint.
    startupSignal.throwIfAborted();
    await verifyLaunchPreflight(composition);
    startupSignal.throwIfAborted();
    const consoleEnabled = ctx.resolved.launch.console;
    const clientTitle = ctx.item.presentation.title || key;
    env.console.setActiveSession({
      key,
      clientTitle,
      state: { key, status: ConsoleStatuses.LAUNCHING, clientTitle },
    });
    env.console.emitState({ key, status: ConsoleStatuses.LAUNCHING, clientTitle });
    env.console.recordSystem('Launching…', { code: 'console.system.launching', key });
    if (consoleEnabled) env.openConsole();
    const session = env.kit.launch.run(composition, {
      signal: startupSignal,
      onEvent: (event) => {
        switch (event.type) {
          case EventTypes.LAUNCH_STARTING:
            env.logger.info(`[${key}] launch: starting ${event.command} (cwd ${event.cwd})`);
            return;
          case EventTypes.LAUNCH_STARTED:
            env.logger.info(`[${key}] launch: started pid=${event.pid}`);
            return;
          case EventTypes.LAUNCH_EXITED:
            env.logger.info(
              `[${key}] launch: exited code=${event.code ?? 'null'} signal=${event.signal ?? 'null'}`,
            );
            return;
          case EventTypes.LAUNCH_ABORTED:
            env.logger.info(`[${key}] launch: aborted (${event.reason})`);
            return;
          case EventTypes.LAUNCH_STDOUT:
          case EventTypes.LAUNCH_STDERR: {
            const stream =
              event.type === EventTypes.LAUNCH_STDOUT
                ? ConsoleSources.STDOUT
                : ConsoleSources.STDERR;
            env.console.recordMinecraft(key, stream, event.line);
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
    env.ops.set(key, { kind: OpKinds.LAUNCH, session });
    // Observe termination before any post-spawn bookkeeping that could throw, else
    // a failure below leaves the process unobserved or the LAUNCH op stranded
    // (bricking the key via requireIdle). The trailing .catch guards endLaunch.
    void session.exited
      .then((exit) => {
        endLaunch(env, key, undefined, exit);
      })
      .catch((error: unknown) => {
        endLaunch(env, key, error);
      })
      .catch((error: unknown) => {
        env.logger.error(`[${key}] endLaunch threw`, error);
      });

    // Stamp Home recents with the resolved item's key (not the requested one) so
    // the renderer matches it against the catalog. Best-effort.
    try {
      recordPlayed(ctx.item.key);
    } catch (error) {
      env.logger.warn(`[${key}] failed to record last-played`, error);
    }
    env.emitStatus({ key, status: InstallStatuses.RUNNING, paused: false });
    env.console.emitState({ key, status: ConsoleStatuses.RUNNING, clientTitle });
    env.console.recordSystem('Process started', {
      code: 'console.system.processStarted',
      key,
    });
  } catch (error) {
    if (startupSignal.aborted) {
      restoreInstalled();
      return;
    }
    if (isLaunchPreflightError(error)) {
      const message = errorMessage(error);
      launchLogger.warn(`[${key}] launch preflight failed - ${message}`, error);
      // Keep the client INSTALLED (affordance stays "Play"); the renderer turns the
      // error event into a repair toast rather than us silently reinstalling.
      env.console.recordSystem(`Launch check failed: ${message}`, { key });
      if (!env.console.hasWindow()) env.openConsole();
      env.emitError(key, error.code, message);
      env.emitStatus({ key, status: InstallStatuses.INSTALLED, paused: false });
      return;
    }
    env.logger.error(`[${key}] launch failed`, error);
    env.emitError(key, classifyError(error, startupSignal), errorMessage(error));
    env.emitStatus({ key, status: InstallStatuses.INSTALLED, paused: false });
    const message = errorMessage(error);
    env.console.emitState({ key, status: ConsoleStatuses.ERROR, message });
    env.console.recordSystem(`Process error: ${message}`, { key });
    if (!env.console.hasWindow()) env.openConsole();
    // Already surfaced via emitError; re-throwing would double-surface it as an
    // IPC rejection (second toast) plus an error-level handler log.
  } finally {
    if (env.ops.get(key) === startupOp) env.ops.delete(key);
  }
};

export const requireAccount = (account: Account | null): Account => {
  if (account) return account;
  throw new MinecraftError(MinecraftErrorCodes.NO_ACCOUNT, 'Sign in before launching');
};
