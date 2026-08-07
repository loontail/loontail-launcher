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

// Distinct failures the renderer can localize by code rather than by error.message.
export const SkinErrorCodes = {
  NOT_AUTHENTICATED: 'skin/notAuthenticated',
  INVALID_IMAGE: 'skin/invalidImage',
  CAPE_UNSUPPORTED: 'skin/capeUnsupported',
  UPLOAD_FAILED: 'skin/uploadFailed',
  UPLOAD_NO_URL: 'skin/uploadNoUrl',
  CLEAR_FAILED: 'skin/clearFailed',
} as const;

export type SkinErrorCode = (typeof SkinErrorCodes)[keyof typeof SkinErrorCodes];
