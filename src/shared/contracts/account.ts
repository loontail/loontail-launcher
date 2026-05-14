import { z } from 'zod';

export const AccountSchema = z.object({
  id: z.number(),
  username: z.string(),
  email: z.string().email(),
  blocked: z.boolean(),
  skin: z.string().nullable().optional(),
  cape: z.string().nullable().optional(),
});

export type Account = z.infer<typeof AccountSchema>;
