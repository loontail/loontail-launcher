import { z } from 'zod';

export const SKIN_KINDS = ['skin', 'cape'] as const;
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
