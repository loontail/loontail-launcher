import { z } from 'zod';

export const StrapiEntitySchema = z.object({
  id: z.number(),
  documentId: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().optional(),
});

export type StrapiEntity = z.infer<typeof StrapiEntitySchema>;

export const StrapiImageFormatSchema = z.object({
  url: z.string(),
  ext: z.string(),
  width: z.number(),
  height: z.number(),
  size: z.number(),
  name: z.string(),
  hash: z.string(),
});

export type StrapiImageFormat = z.infer<typeof StrapiImageFormatSchema>;

export const StrapiMediaSchema = StrapiEntitySchema.extend({
  url: z.string(),
  ext: z.string(),
  width: z.number(),
  height: z.number(),
  size: z.number(),
  name: z.string(),
  hash: z.string(),
  formats: z.object({
    thumbnail: StrapiImageFormatSchema.optional(),
    large: StrapiImageFormatSchema.optional(),
    medium: StrapiImageFormatSchema.optional(),
    small: StrapiImageFormatSchema.optional(),
  }),
});

export type StrapiMedia = z.infer<typeof StrapiMediaSchema>;

export const StrapiListSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    data: z.array(itemSchema),
    meta: z.object({
      pagination: z.object({
        page: z.number(),
        pageSize: z.number(),
        pageCount: z.number(),
        total: z.number(),
      }),
    }),
  });

export type StrapiList<T> = {
  data: T[];
  meta: {
    pagination: {
      page: number;
      pageSize: number;
      pageCount: number;
      total: number;
    };
  };
};

export const ServerSchema = StrapiEntitySchema.extend({
  name: z.string().optional(),
  address: z.string(),
});

export type Server = z.infer<typeof ServerSchema>;
