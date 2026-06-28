import { getSettings } from '@main/services/settings/settings';
import type { CatalogKey } from '@shared/contracts/ids';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { resolveClientSettings } from '@shared/domain/settings';
import { loadTargetInstallManifest } from './installManifest';
import { isAnythingInstalled } from './runtimeState';

// Offline open-time status seed: reads only local state (manifest + version
// files), never resolves the target or hits the network. The target match is
// deferred to Play, so a backend version bump is not detected here (the stale
// manifest still reads INSTALLED) — it surfaces when buildContext resolves the
// new target at Play. Files present without our manifest → UNVERIFIED.
export const resolveClientInstallPresence = async (slug: CatalogKey): Promise<InstallStatus> => {
  const folder = resolveClientSettings(getSettings(), slug).storage.clientFolder || null;
  if (folder === null) return InstallStatuses.NOT_INSTALLED;
  // Our durable manifest is only written after a verified install/repair, so its
  // presence already implies on-disk files — skip the version scan on the happy path.
  const manifest = await loadTargetInstallManifest(folder);
  if (manifest !== null) return InstallStatuses.INSTALLED;
  const installed = await isAnythingInstalled(folder);
  return installed ? InstallStatuses.UNVERIFIED : InstallStatuses.NOT_INSTALLED;
};
