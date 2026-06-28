import type { MinecraftKit, RepairIssueFilter } from '@loontail/minecraft-kit';
import type { ConsoleHub } from '@main/infra/consoleHub';
import type { scopedLogger } from '@main/infra/logger';
import type { CatalogKey } from '@shared/contracts/ids';
import type { MinecraftErrorCode, MinecraftStatusEvent } from '@shared/contracts/minecraft';
import type { Broadcaster } from './broadcast';
import type { ForgeProcessorCache } from './forgeProcessorHealing';
import type { Op } from './ops';

// Injected (not the module singleton) so a launch can be tested with a spy and
// never pulls a live ConsoleHub's timer/window refs into the test process.
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
  // Injected from the bundle service so the repair path stays free of a static
  // bundle import: returns a kit filter that skips bundle-owned paths, or null.
  resolveBundleRepairFilter: (
    clientFolder: string,
    expectedBundleSlug: string,
  ) => Promise<RepairIssueFilter | null>;
};
