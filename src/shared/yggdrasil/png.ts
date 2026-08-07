import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';

// Byte layout of a PNG header: an 8-byte signature followed by the IHDR chunk
// (4-byte big-endian length, 4-byte type, then width and height as big-endian
// u32s). Everything below is offsets into that fixed 24-byte prefix — a skin
// only has to be a well-formed PNG of a known size, so nothing past it is read.
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const IHDR_LENGTH = 13;
const PNG_HEADER_MIN_BYTES = 24;
const IHDR_LENGTH_OFFSET = 8;
const IHDR_TYPE_OFFSET = 12;
const IHDR_WIDTH_OFFSET = 16;
const IHDR_HEIGHT_OFFSET = 20;

const SKIN_VALID_DIMENSIONS = ['64x64', '64x32'] as const;
const CAPE_VALID_DIMENSIONS = ['64x32'] as const;

export const SkinAssetKinds = {
  SKIN: 'skin',
  CAPE: 'cape',
} as const;

export type SkinAssetKind = (typeof SkinAssetKinds)[keyof typeof SkinAssetKinds];

export type PngValidationResult =
  | { readonly ok: true; readonly width: number; readonly height: number }
  | { readonly ok: false; readonly reason: string };

const readUInt32BE = (view: Uint8Array, offset: number): number =>
  (((view[offset] ?? 0) << 24) |
    ((view[offset + 1] ?? 0) << 16) |
    ((view[offset + 2] ?? 0) << 8) |
    (view[offset + 3] ?? 0)) >>>
  0;

const toUint8 = (buffer: ArrayBuffer | Uint8Array): Uint8Array =>
  buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

export const validatePngBuffer = (
  buffer: ArrayBuffer | Uint8Array,
  kind: SkinAssetKind,
): PngValidationResult => {
  const view = toUint8(buffer);
  if (view.length < PNG_HEADER_MIN_BYTES) {
    return {
      ok: false,
      reason: `file too small to be a PNG (need at least ${PNG_HEADER_MIN_BYTES} bytes)`,
    };
  }
  if (PNG_SIGNATURE.some((b, i) => view[i] !== b)) {
    const head = Array.from(view.subarray(0, PNG_SIGNATURE.length))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    return { ok: false, reason: `file is not a PNG (header ${head})` };
  }
  const ihdrLength = readUInt32BE(view, IHDR_LENGTH_OFFSET);
  if (ihdrLength !== IHDR_LENGTH) {
    return { ok: false, reason: `IHDR chunk length is ${ihdrLength}, expected ${IHDR_LENGTH}` };
  }
  const ihdrType = String.fromCharCode(
    view[IHDR_TYPE_OFFSET] ?? 0,
    view[IHDR_TYPE_OFFSET + 1] ?? 0,
    view[IHDR_TYPE_OFFSET + 2] ?? 0,
    view[IHDR_TYPE_OFFSET + 3] ?? 0,
  );
  if (ihdrType !== 'IHDR') {
    return { ok: false, reason: `first PNG chunk is "${ihdrType}", expected "IHDR"` };
  }
  const width = readUInt32BE(view, IHDR_WIDTH_OFFSET);
  const height = readUInt32BE(view, IHDR_HEIGHT_OFFSET);
  const allowed: readonly string[] =
    kind === SkinAssetKinds.SKIN ? SKIN_VALID_DIMENSIONS : CAPE_VALID_DIMENSIONS;
  if (!allowed.includes(`${width}x${height}`)) {
    return {
      ok: false,
      reason: `${kind} dimensions ${width}x${height} are not supported (expected ${allowed.join(' or ')})`,
    };
  }
  return { ok: true, width, height };
};

export const assertPngBuffer = (
  buffer: ArrayBuffer | Uint8Array,
  kind: SkinAssetKind,
): { readonly width: number; readonly height: number } => {
  const verdict = validatePngBuffer(buffer, kind);
  if (verdict.ok) return { width: verdict.width, height: verdict.height };
  throw new YggdrasilError(YggdrasilErrorCodes.INVALID_PNG, verdict.reason, {
    context: { kind, reason: verdict.reason },
  });
};
