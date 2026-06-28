import { toast } from '@renderer/shared/ui/Toast';
import { NotificationVariants } from '@shared/contracts/notification';
import { IPC_EVENTS } from '@shared/ipc';
import { useEffect } from 'react';

// Mount once at app root: relays `app.notification` IPC events to the toast system.
export const NotificationsListener = (): null => {
  useEffect(
    () =>
      window.api.on(IPC_EVENTS.appNotification, ({ variant, message }) => {
        switch (variant) {
          case NotificationVariants.SUCCESS:
            toast.success(message);
            return;
          case NotificationVariants.ERROR:
            toast.error(message);
            return;
          case NotificationVariants.INFO:
            toast.info(message);
            return;
          case NotificationVariants.WARN:
            toast.warn(message);
            return;
        }
      }),
    [],
  );
  return null;
};
