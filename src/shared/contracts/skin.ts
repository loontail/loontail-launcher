import { z } from 'zod';

export const SkinKinds = {
  SKIN: 'skin',
  CAPE: 'cape',
} as const;

export const SKIN_KINDS = [SkinKinds.SKIN, SkinKinds.CAPE] as const;
export type SkinKind = (typeof SKIN_KINDS)[number];

export const SkinKindSchema = z.enum(SKIN_KINDS);

export const MOJANG_SKIN_VARIANTS = ['CLASSIC', 'SLIM'] as const;
export const MojangSkinVariantSchema = z.enum(MOJANG_SKIN_VARIANTS);

export const UploadSkinPayloadSchema = z.object({
  type: SkinKindSchema,
  buffer: z.custom<ArrayBuffer>((value) => value instanceof ArrayBuffer, {
    message: 'buffer must be an ArrayBuffer',
  }),
  // Picked by the user in the Mojang skin slot UI. Ignored for Strapi
  // uploads and for cape uploads.
  variant: MojangSkinVariantSchema.optional(),
});

export type UploadSkinPayload = z.infer<typeof UploadSkinPayloadSchema>;

export type UploadSkinResult = { url: string };
