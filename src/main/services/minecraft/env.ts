import type { MinecraftKit, RepairIssueFilter } from '@loontail/minecraft-kit';
import type { ConsoleHub } from '@main/infra/consoleHub';
import type { scopedLogger } from '@main/infra/logger';
import type { CatalogKey } from '@shared/contracts/ids';
import type { MinecraftErrorCode, MinecraftStatusEvent } from '@shared/contracts/minecraft';
import type { Broadcaster } from './broadcast';
import type { ForgeProcessorCache } from './forgeProcessorHealing';
import type { Op } from './ops';

// The launch flow's view of the console hub, injected like every other
// side-effect rather than reached through the module singleton, so a launch
// can be unit-tested with a spy and never pulls a live ConsoleHub (with its
// timer and window references) into the test process.
export type ConsolePort = Pick<
  ConsoleHub,
  'setActiveSession' | 'emitState' | 'recordSystem' | 'recordMinecraft' | 'hasWindow' | 'endSession'
>;

export type ManagerEnv = {
  kit: MinecraftKit;
  broadcaster: Broadcaster;
  ops: Map<CatalogKey, Op>;
  forgeProcessorCache: ForgeProcessorCache;
  console: ConsolePort;
  openConsole: () => void;
  logger: ReturnType<typeof scopedLogger>;
  emitStatus: (payload: MinecraftStatusEvent) => void;
  emitError: (key: CatalogKey, code: MinecraftErrorCode, message: string) => void;
  persistRuntime: (
    key: CatalogKey,
    runtime: { component: string; path: string } | undefined,
  ) => void;
  clearRuntimeOverride: (key: CatalogKey) => void;
  // Heal port (injected at the composition root from the bundle service): given
  // a client folder + the build's bundle slug, return a kit filter that skips
  // bundle-owned paths during repair, or null when nothing is owned. Keeps the
  // minecraft repair path free of any static bundle import.
  resolveBundleRepairFilter: (
    clientFolder: string,
    expectedBundleSlug: string,
  ) => Promise<RepairIssueFilter | null>;
};
