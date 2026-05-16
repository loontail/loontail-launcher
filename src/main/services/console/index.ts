import { consoleHub } from '@main/infra/consoleHub';
import { parseIpcArgs } from '@main/ipc/parseArgs';
import type { Router } from '@main/ipc/router';
import { IPC_CHANNELS } from '@shared/ipc';
import { clipboard } from 'electron';
import { z } from 'zod';

const CopyTextArgsSchema = z.string();

export type ConsoleService = {
  init: () => Promise<void>;
  dispose: () => Promise<void>;
};

export const createConsoleService = (router: Router): ConsoleService => ({
  init: async () => {
    router.handle(IPC_CHANNELS.consoleGetInitial, () => consoleHub.getInitial());
    router.handle(IPC_CHANNELS.consoleClear, () => {
      consoleHub.clear();
    });
    // Write via the native clipboard module instead of `navigator.clipboard`:
    // the renderer's permission handler denies `clipboard-write` by default,
    // and writing from main bypasses Chromium's focus / permission gating.
    router.handle(IPC_CHANNELS.consoleCopyAll, () => {
      clipboard.writeText(consoleHub.copyAll());
    });
    router.handle(IPC_CHANNELS.consoleCopyText, (rawArgs) => {
      const text = parseIpcArgs(CopyTextArgsSchema, rawArgs, 'text must be a string');
      clipboard.writeText(text);
    });
  },
  dispose: async () => {
    /* nothing to dispose — router.dispose() clears handlers */
  },
});
