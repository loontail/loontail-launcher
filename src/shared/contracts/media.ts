import { z } from 'zod';

export const MediaSchema = z.object({
  url: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
});

export type Media = z.infer<typeof MediaSchema>;

export const ServerSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  address: z.string(),
});

export type Server = z.infer<typeof ServerSchema>;
