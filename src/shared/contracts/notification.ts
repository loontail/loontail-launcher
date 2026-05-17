import { z } from 'zod';

export type NotificationVariant = 'success' | 'error' | 'info' | 'warn';

export const NotificationVariants = {
  SUCCESS: 'success',
  ERROR: 'error',
  INFO: 'info',
  WARN: 'warn',
} as const satisfies Record<string, NotificationVariant>;

export const NotificationPayloadSchema = z.object({
  variant: z.enum([
    NotificationVariants.SUCCESS,
    NotificationVariants.ERROR,
    NotificationVariants.INFO,
    NotificationVariants.WARN,
  ]),
  message: z.string(),
});

export type NotificationPayload = z.infer<typeof NotificationPayloadSchema>;
