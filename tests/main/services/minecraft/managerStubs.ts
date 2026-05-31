import type { ConsolePort } from '@main/services/minecraft/env';
import type { AccountProvider } from '@main/services/minecraft/manager';
import { vi } from 'vitest';

export const stubConsolePort = (): ConsolePort => ({
  setActiveSession: vi.fn(),
  emitState: vi.fn(),
  recordSystem: vi.fn(),
  recordMinecraft: vi.fn(),
  hasWindow: vi.fn(() => false),
  endSession: vi.fn(),
});

export const stubOpenConsole = (): (() => void) => vi.fn();

export const stubAccountProvider = (account: ReturnType<AccountProvider> = null): AccountProvider =>
  vi.fn(() => account);
