import { getSettings } from '@main/services/settings/settings';
import type { ClientSlug } from '@shared/contracts/ids';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { resolveClientSettings } from '@shared/domain/settings';
import { loadTargetInstallManifest } from './installManifest';
import { isAnythingInstalled } from './runtimeState';

// Cheap, fully offline "do we already have this install?" check used to seed
// status when the launcher opens. Reads ONLY local state — the durable install
// manifest file plus on-disk version files — and never resolves the target,
// hits the network, or runs hash/manifest verification.
//
// The target match is deliberately deferred to Play: a current durable manifest
// means we wrote this install, so we report INSTALLED without re-resolving the
// target. A Strapi version bump is therefore not detected at open (the stale
// manifest still reads INSTALLED); it surfaces at Play, where buildContext
// resolves the new target and the lenient launch preflight gates launchability.
// Files present without our manifest is a legacy/foreign install we cannot
// attribute to a target → UNVERIFIED.
export const resolveClientInstallPresence = async (slug: ClientSlug): Promise<InstallStatus> => {
  const folder = resolveClientSettings(getSettings(), slug).storage.clientFolder || null;
  if (folder === null) return InstallStatuses.NOT_INSTALLED;
  // Our durable manifest is only written after a verified install/repair, so its
  // presence already implies on-disk files — skip the version scan on the happy
  // path and only pay it to distinguish a legacy install from an empty folder.
  const manifest = await loadTargetInstallManifest(folder);
  if (manifest !== null) return InstallStatuses.INSTALLED;
  const installed = await isAnythingInstalled(folder);
  return installed ? InstallStatuses.UNVERIFIED : InstallStatuses.NOT_INSTALLED;
};
