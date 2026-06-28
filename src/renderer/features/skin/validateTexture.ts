import { type SkinAssetKind, validatePngBuffer } from '@loontail/yggdrasil-core';
import type { SkinKind } from '@shared/contracts/skin';

// SkinKind shares yggdrasil-core's 'skin'|'cape' literals, so it is always a valid SkinAssetKind.
const toAssetKind = (kind: SkinKind): SkinAssetKind => kind;

// Defence-in-depth: fail fast in the renderer before the IPC round-trip; the main-side check stays authoritative.
export const validateTexture = (buffer: ArrayBuffer, kind: SkinKind): string | null => {
  const verdict = validatePngBuffer(buffer, toAssetKind(kind));
  return verdict.ok ? null : verdict.reason;
};
