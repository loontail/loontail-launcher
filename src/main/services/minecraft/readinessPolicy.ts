import type { MinecraftKit } from '@loontail/minecraft-kit';
import { scopedLogger } from '@main/infra/logger';
import { getSettings } from '@main/services/settings/settings';
import type { ClientSlug } from '@shared/contracts/ids';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { resolveClientSettings } from '@shared/domain/settings';
import { buildContext } from './context';
import type { Context } from './context';
import {
  hasCurrentTargetInstallManifest,
  saveCurrentTargetInstallManifest,
} from './installManifest';
import {
  type TargetInstallState,
  type TargetInstallStateOptions,
  getTargetInstallState,
  isAnythingInstalled,
  isMinecraftTargetReady,
} from './runtimeState';

export const ReadinessPolicyKinds = {
  INSTALLED: 'installed',
  NEEDS_INSTALL: 'needs-install',
  NEEDS_REPAIR: 'needs-repair',
  UNVERIFIED: 'unverified',
} as const;

export type ReadinessPolicyKind = (typeof ReadinessPolicyKinds)[keyof typeof ReadinessPolicyKinds];

type InstalledReadiness = {
  readonly kind: typeof ReadinessPolicyKinds.INSTALLED;
  readonly status: typeof InstallStatuses.INSTALLED;
  readonly ctx: Context;
  readonly hasCurrentManifest: boolean;
  readonly targetState: TargetInstallState;
  readonly freshInstall: false;
};

type NeedsInstallReadiness = {
  readonly kind: typeof ReadinessPolicyKinds.NEEDS_INSTALL;
  readonly status: typeof InstallStatuses.NOT_INSTALLED;
  readonly ctx: Context;
  readonly hasCurrentManifest: false;
  readonly targetState: null;
  readonly freshInstall: boolean;
};

type NeedsRepairReadiness = {
  readonly kind: typeof ReadinessPolicyKinds.NEEDS_REPAIR;
  readonly status: typeof InstallStatuses.NOT_INSTALLED;
  readonly ctx: Context;
  readonly hasCurrentManifest: true;
  readonly targetState: TargetInstallState;
  readonly freshInstall: boolean;
};

export type TargetReadinessPolicyResult =
  | InstalledReadiness
  | NeedsInstallReadiness
  | NeedsRepairReadiness;

const logger = scopedLogger('minecraft.readinessPolicy');

const legacyInstallFreshness = async (clientFolder: string): Promise<boolean> =>
  !(await isAnythingInstalled(clientFolder));

const refreshTargetInstallManifest = async (ctx: Context): Promise<void> => {
  try {
    await saveCurrentTargetInstallManifest(ctx.clientFolder, ctx.target);
  } catch (error) {
    logger.warn(`[${ctx.client.slug}] readiness: failed to refresh target install manifest`, error);
  }
};

export const resolveTargetReadinessPolicy = async (
  kit: MinecraftKit,
  ctx: Context,
  options: TargetInstallStateOptions = {},
): Promise<TargetReadinessPolicyResult> => {
  const hasCurrentManifest = await hasCurrentTargetInstallManifest(ctx.clientFolder, ctx.target);
  const targetState = await getTargetInstallState(kit, ctx.target, options);
  if (isMinecraftTargetReady(targetState)) {
    if (!hasCurrentManifest) await refreshTargetInstallManifest(ctx);
    return {
      kind: ReadinessPolicyKinds.INSTALLED,
      status: InstallStatuses.INSTALLED,
      ctx,
      hasCurrentManifest,
      targetState,
      freshInstall: false,
    };
  }

  if (!hasCurrentManifest) {
    return {
      kind: ReadinessPolicyKinds.NEEDS_INSTALL,
      status: InstallStatuses.NOT_INSTALLED,
      ctx,
      hasCurrentManifest: false,
      targetState: null,
      freshInstall: await legacyInstallFreshness(ctx.clientFolder),
    };
  }

  return {
    kind: ReadinessPolicyKinds.NEEDS_REPAIR,
    status: InstallStatuses.NOT_INSTALLED,
    ctx,
    hasCurrentManifest: true,
    targetState,
    freshInstall: await legacyInstallFreshness(ctx.clientFolder),
  };
};

// Cheap "do we already have this install?" check used to seed status when the
// launcher opens. Reads ONLY local state — the durable install manifest plus
// on-disk files — and never runs hash/manifest verification. Verification is
// reserved for the explicit repair flow and the lenient launch preflight, so
// opening the launcher stays off the network and a flaky/offline verification
// can no longer demote a working install to "Download".
export const resolveClientInstallPresence = async (
  kit: MinecraftKit,
  slug: ClientSlug,
): Promise<InstallStatus> => {
  let ctx: Context;
  try {
    ctx = await buildContext(kit, slug);
  } catch {
    const folder = resolveClientSettings(getSettings(), slug).storage.clientFolder || null;
    const hasLegacyInstall = folder === null ? false : await isAnythingInstalled(folder);
    return hasLegacyInstall ? InstallStatuses.UNVERIFIED : InstallStatuses.NOT_INSTALLED;
  }
  const [hasCurrentManifest, installed] = await Promise.all([
    hasCurrentTargetInstallManifest(ctx.clientFolder, ctx.target),
    isAnythingInstalled(ctx.clientFolder),
  ]);
  return hasCurrentManifest && installed
    ? InstallStatuses.INSTALLED
    : InstallStatuses.NOT_INSTALLED;
};
