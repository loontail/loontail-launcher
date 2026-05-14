import { z } from 'zod';

export const DiskInfoSchema = z.object({
  path: z.string().optional(),
  diskPath: z.string().optional(),
  free: z.number().optional(),
  size: z.number().optional(),
  error: z.boolean().optional(),
});

export type DiskInfo = z.infer<typeof DiskInfoSchema>;

export const PickedFolderSchema = z.object({
  path: z.string(),
  diskPath: z.string().optional(),
  free: z.number().optional(),
  size: z.number().optional(),
});

export type PickedFolder = z.infer<typeof PickedFolderSchema>;
