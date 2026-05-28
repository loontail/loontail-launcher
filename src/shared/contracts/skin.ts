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
