import { type SkinAssetKind, validatePngBuffer } from '@loontail/yggdrasil-core';
import type { SkinKind } from '@shared/contracts/skin';

// SkinKind shares yggdrasil-core's 'skin'|'cape' literals (asserted in the
// main-process skin service), so a SkinKind is always a valid SkinAssetKind.
const toAssetKind = (kind: SkinKind): SkinAssetKind => kind;

// Defence-in-depth: validate the encoded PNG in the renderer before the IPC
// round-trip so dimension/corruption errors fail fast on save instead of after
// a main-process rejection. validatePngBuffer is browser-safe (Uint8Array /
// DataView only). The main-side check stays the authoritative guard.
export const validateTexture = (buffer: ArrayBuffer, kind: SkinKind): string | null => {
  const verdict = validatePngBuffer(buffer, toAssetKind(kind));
  return verdict.ok ? null : verdict.reason;
};
