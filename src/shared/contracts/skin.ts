import { z } from 'zod';

export const SkinKinds = {
  SKIN: 'skin',
  CAPE: 'cape',
} as const;

export const SKIN_KINDS = [SkinKinds.SKIN, SkinKinds.CAPE] as const;
export type SkinKind = (typeof SKIN_KINDS)[number];

export const SkinKindSchema = z.enum(SKIN_KINDS);

export const UploadSkinPayloadSchema = z.object({
  type: SkinKindSchema,
  buffer: z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer, {
    message: 'buffer must be an ArrayBuffer',
  }),
});

export type UploadSkinPayload = z.infer<typeof UploadSkinPayloadSchema>;

export type UploadSkinResult = { url: string };

// Domain-local skin error codes, mirroring BundleErrorCodes/MinecraftErrorCodes
// placement. Each value names a distinct failure the renderer can localize by
// code instead of relying on whatever English string lands in error.message.
export const SkinErrorCodes = {
  NOT_AUTHENTICATED: 'SKIN_NOT_AUTHENTICATED',
  INVALID_IMAGE: 'SKIN_INVALID_IMAGE',
  CAPE_UNSUPPORTED: 'SKIN_CAPE_UNSUPPORTED',
  UPLOAD_FAILED: 'SKIN_UPLOAD_FAILED',
  UPLOAD_NO_URL: 'SKIN_UPLOAD_NO_URL',
  CLEAR_FAILED: 'SKIN_CLEAR_FAILED',
} as const;

export type SkinErrorCode = (typeof SkinErrorCodes)[keyof typeof SkinErrorCodes];
