import { AuthModes, EventTypes } from '@loontail/minecraft-kit';
import { consoleHub } from '@main/infra/consoleHub';
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

export const runLaunch = async (
  env: ManagerEnv,
  slug: ClientSlug,
  ctx: Context,
  account: Account,
): Promise<void> => {
  env.emitStatus({ slug, status: InstallStatuses.LAUNCHING, paused: false });
  try {
    const composition = await env.kit.launch.compose(ctx.target, {
      auth: { mode: AuthModes.OFFLINE, username: account.username },
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
        if (event.type !== EventTypes.LAUNCH_STDOUT && event.type !== EventTypes.LAUNCH_STDERR)
          return;
        const stream =
          event.type === EventTypes.LAUNCH_STDOUT ? ConsoleSources.STDOUT : ConsoleSources.STDERR;
        consoleHub.recordMinecraft(slug, stream, event.line);
        // Keep the legacy `minecraft.log` IPC event for external subscribers.
        if (consoleEnabled) {
          env.broadcaster.log({ slug, stream, line: event.line });
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
