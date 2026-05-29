import type { MinecraftKit } from '@loontail/minecraft-kit';
import { getSettings } from '@main/services/settings/settings';
import type { ClientSlug } from '@shared/contracts/ids';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { resolveClientSettings } from '@shared/domain/settings';
import { buildContext } from './context';
import type { Context } from './context';
import { hasCurrentTargetInstallManifest } from './installManifest';
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
  readonly hasCurrentManifest: true;
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

type UnverifiedReadiness = {
  readonly kind: typeof ReadinessPolicyKinds.UNVERIFIED;
  readonly status: typeof InstallStatuses.UNVERIFIED | typeof InstallStatuses.NOT_INSTALLED;
  readonly hasLegacyInstall: boolean;
  readonly freshInstall: boolean;
};

export type TargetReadinessPolicyResult =
  | InstalledReadiness
  | NeedsInstallReadiness
  | NeedsRepairReadiness;

export type ClientReadinessPolicyResult = TargetReadinessPolicyResult | UnverifiedReadiness;

const legacyInstallFreshness = async (clientFolder: string): Promise<boolean> =>
  !(await isAnythingInstalled(clientFolder));

export const resolveTargetReadinessPolicy = async (
  kit: MinecraftKit,
  ctx: Context,
  options: TargetInstallStateOptions = {},
): Promise<TargetReadinessPolicyResult> => {
  const hasCurrentManifest = await hasCurrentTargetInstallManifest(ctx.clientFolder, ctx.target);
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

  const targetState = await getTargetInstallState(kit, ctx.target, options);
  if (isMinecraftTargetReady(targetState)) {
    return {
      kind: ReadinessPolicyKinds.INSTALLED,
      status: InstallStatuses.INSTALLED,
      ctx,
      hasCurrentManifest: true,
      targetState,
      freshInstall: false,
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

export const resolveClientReadinessPolicy = async (
  kit: MinecraftKit,
  slug: ClientSlug,
): Promise<ClientReadinessPolicyResult> => {
  try {
    return await resolveTargetReadinessPolicy(kit, await buildContext(kit, slug));
  } catch {
    const folder = resolveClientSettings(getSettings(), slug).storage.clientFolder || null;
    const hasLegacyInstall = folder === null ? false : await isAnythingInstalled(folder);
    return {
      kind: ReadinessPolicyKinds.UNVERIFIED,
      status: hasLegacyInstall ? InstallStatuses.UNVERIFIED : InstallStatuses.NOT_INSTALLED,
      hasLegacyInstall,
      freshInstall: !hasLegacyInstall,
    };
  }
};
