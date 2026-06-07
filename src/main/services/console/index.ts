import type { ConsoleHub } from '@main/infra/consoleHub';
import { assertNoIpcArgs, parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { clipboard } from 'electron';
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
    // Write via the native clipboard module instead of `navigator.clipboard`:
    // the renderer's permission handler denies `clipboard-write` by default,
    // and writing from main bypasses Chromium's focus / permission gating.
    router.handle(IPC_CHANNELS.consoleCopyAll, (rawArgs) => {
      assertNoIpcArgs(rawArgs, 'console.copyAll takes no arguments');
      clipboard.writeText(consoleHub.copyAll());
    });
    router.handle(IPC_CHANNELS.consoleCopyText, (rawArgs) => {
      const text = parseIpcArgs(CopyTextArgsSchema, rawArgs, 'text must be a string');
      clipboard.writeText(text);
    });
  },
  dispose: async () => {
    // Flush any pending lines and clear the batching timer so the last batch
    // is not lost between the next setTimeout fire and process exit.
    consoleHub.flushPending();
  },
});
