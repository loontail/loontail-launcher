import type { MinecraftKit } from '@loontail/minecraft-kit';
import type { scopedLogger } from '@main/infra/logger';
import type { ClientSlug } from '@shared/contracts/ids';
import type { MinecraftErrorCode, MinecraftStatusEvent } from '@shared/contracts/minecraft';
import type { Broadcaster } from './broadcast';
import type { Op } from './ops';

export type ManagerEnv = {
  kit: MinecraftKit;
  broadcaster: Broadcaster;
  ops: Map<ClientSlug, Op>;
  logger: ReturnType<typeof scopedLogger>;
  emitStatus: (payload: MinecraftStatusEvent) => void;
  emitError: (slug: ClientSlug, code: MinecraftErrorCode, message: string) => void;
  persistRuntime: (
    slug: ClientSlug,
    runtime: { component: string; path: string } | undefined,
  ) => void;
  clearRuntimeOverride: (slug: ClientSlug) => void;
};
