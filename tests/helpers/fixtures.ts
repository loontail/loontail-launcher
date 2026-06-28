import type { BundleBroadcaster } from '@main/services/bundle/broadcast';
import type { Healer } from '@main/services/bundle/healer';
import type { Broadcaster } from '@main/services/minecraft/broadcast';
import type { LauncherSettings } from '@shared/contracts/settings';
import { vi } from 'vitest';

type DeepPartial<T> = T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const deepMerge = <T>(base: T, overrides: DeepPartial<T>): T => {
  const result = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(overrides as Record<string, unknown>)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] =
      isPlainObject(current) && isPlainObject(value) ? deepMerge(current, value) : value;
  }
  return result as T;
};

export const makeLauncherSettings = (
  overrides: DeepPartial<LauncherSettings> = {},
): LauncherSettings =>
  deepMerge<LauncherSettings>(
    {
      memory: { allocatedRamMb: 0 },
      storage: { clientsFolder: '/tmp/clients' },
      launch: { console: false, fullscreen: false },
      clients: {},
    },
    overrides,
  );

export const makeBroadcaster = (): BundleBroadcaster => ({
  status: vi.fn(),
  progress: vi.fn(),
  error: vi.fn(),
});

export const makeMinecraftBroadcaster = (): Broadcaster =>
  ({
    status: vi.fn(),
    progress: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
  }) as unknown as Broadcaster;

export const makeHealer = (): Healer =>
  ({ healAfterDeletes: vi.fn(async () => {}) }) as unknown as Healer;
