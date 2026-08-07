import { writeClipboardText } from '@main/infra/clipboard';
import type { ConsoleHub } from '@main/infra/consoleHub';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import type { LauncherService } from '@main/services/service';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';

const CopyTextArgsSchema = z.string();

export type ConsoleService = LauncherService;

export const createConsoleService = (
  router: Router,
  consoleHub: ConsoleHub,
  openConsole: () => void,
): ConsoleService => ({
  init: async () => {
    router.handleNoArgs(IPC_CHANNELS.consoleOpen, () => {
      openConsole();
    });
    router.handleNoArgs(IPC_CHANNELS.consoleGetInitial, () => {
      return consoleHub.getInitial();
    });
    router.handleNoArgs(IPC_CHANNELS.consoleClear, () => {
      consoleHub.clear();
    });
    router.handleNoArgs(IPC_CHANNELS.consoleCopyAll, () => {
      writeClipboardText(consoleHub.copyAll());
    });
    router.handle(IPC_CHANNELS.consoleCopyText, (rawArgs) => {
      const text = parseIpcArgs(CopyTextArgsSchema, rawArgs, 'text must be a string');
      writeClipboardText(text);
    });
  },
  dispose: async () => {
    // Flush the batching timer so the last buffered batch is not lost on exit.
    consoleHub.flushPending();
  },
});
