import path from 'node:path';
import {
  AuthModes,
  EventTypes,
  type LaunchAuth,
  asAzureClientId,
  asPlayerUuid,
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
import { ManagerError, classifyError, errorMessage } from './errors';
import { OpKinds } from './ops';

const launchLogger = scopedLogger('minecraft.launch');

// Placeholder Azure AD client id used to satisfy the kit's `OnlineAuth` shape
// for Yggdrasil sessions. authlib-injector intercepts the Mojang authlib calls
// at JVM init, so the game never contacts Microsoft — but the kit still
// validates the field shape, hence a real-looking zero GUID.
const YGGDRASIL_PLACEHOLDER_CLIENT_ID = asAzureClientId('00000000-0000-0000-0000-000000000000');

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
      extraJvmArgs: [buildAuthlibInjectorJvmArg({ jarPath, apiRoot: mainConfig.yggdrasilApiRoot })],
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
  env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
  try {
    const resolved = resolveLaunchAuth(account);
    if (resolved.extraJvmArgs.length > 0) {
      launchLogger.info(`[${slug}] launch: injecting authlib-injector (yggdrasil session)`);
    }
    const composition = await env.kit.launch.compose(ctx.target, {
      auth: resolved.auth,
      ...(resolved.extraJvmArgs.length > 0 ? { extraJvmArgs: resolved.extraJvmArgs } : {}),
      ...(ctx.resolved.memory.allocatedRamMb > 0
        ? { memory: { maxMb: ctx.resolved.memory.allocatedRamMb } }
        : {}),
      fullscreen: ctx.resolved.launch.fullscreen,
      launcherName: 'elixir',
      launcherVersion: app.getVersion(),
    });
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
    env.logger.error(`[${slug}] launch failed`, error);
    env.emitError(slug, classifyError(error), errorMessage(error));
    env.emitStatus({ slug, status: InstallStatuses.INSTALLED, paused: false });
    const message = errorMessage(error);
    consoleHub.emitState({ slug, status: ConsoleStatuses.ERROR, message });
    consoleHub.recordSystem(`Process error: ${message}`, { slug });
    if (!consoleHub.hasWindow()) openConsoleWindow();
    throw error;
  }
};

export const requireAccount = (account: Account | null): Account => {
  if (account) return account;
  throw new ManagerError(MinecraftErrorCodes.NO_ACCOUNT, 'Sign in before launching');
};
