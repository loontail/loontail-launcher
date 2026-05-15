import { z } from 'zod';

export const ServerStatusSchema = z.object({
  online: z.boolean(),
  players: z.object({ online: z.number(), max: z.number() }).optional(),
  motd: z.object({ clean: z.array(z.string()) }).optional(),
});

export type ServerStatus = z.infer<typeof ServerStatusSchema>;
