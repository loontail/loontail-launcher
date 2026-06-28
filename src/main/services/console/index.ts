import { writeClipboardText } from '@main/infra/clipboard';
import type { ConsoleHub } from '@main/infra/consoleHub';
import { assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { z } from 'zod';

const CopyTextArgsSchema = z.string();

export type ConsoleService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createConsoleService = (
  router: Router,
  consoleHub: ConsoleHub,
  openConsole: () => void,
): ConsoleService => ({
  init: async () => {
    router.handle(IPC_CHANNELS.consoleOpen, (rawArgs) => {
      assertNoIpcArgs(rawArgs, 'console.open takes no arguments');
      openConsole();
    });
    router.handle(IPC_CHANNELS.consoleGetInitial, (rawArgs) => {
      assertNoIpcArgs(rawArgs, 'console.getInitial takes no arguments');
      return consoleHub.getInitial();
    });
    router.handle(IPC_CHANNELS.consoleClear, (rawArgs) => {
      assertNoIpcArgs(rawArgs, 'console.clear takes no arguments');
      consoleHub.clear();
    });
    router.handle(IPC_CHANNELS.consoleCopyAll, (rawArgs) => {
      assertNoIpcArgs(rawArgs, 'console.copyAll takes no arguments');
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
