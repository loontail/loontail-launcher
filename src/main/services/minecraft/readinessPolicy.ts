import type { MinecraftKit } from '@loontail/minecraft-kit';
import { getSettings } from '@main/services/settings/settings';
import type { ClientSlug } from '@shared/contracts/ids';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { resolveClientSettings } from '@shared/domain/settings';
import { buildContext } from './context';
import type { Context } from './context';
import { hasCurrentTargetInstallManifest } from './installManifest';
import { isAnythingInstalled } from './runtimeState';

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
