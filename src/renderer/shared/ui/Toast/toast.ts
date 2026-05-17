export const ToastVariants = {
  SUCCESS: 'success',
  ERROR: 'error',
  INFO: 'info',
  WARN: 'warn',
} as const;

export type ToastVariant = (typeof ToastVariants)[keyof typeof ToastVariants];

export type ToastPayload = {
  message: string;
  variant: ToastVariant;
};

type Listener = (payload: ToastPayload) => void;

let listeners: Listener[] = [];
// Buffer toasts emitted before the container mounts (e.g. emits fired during
// top-level effects that run in the same commit as the container).
const pending: ToastPayload[] = [];

export const subscribeToToasts = (listener: Listener): (() => void) => {
  listeners.push(listener);
  if (pending.length > 0) {
    const queued = pending.splice(0);
    for (const payload of queued) listener(payload);
  }
  return () => {
    listeners = listeners.filter((entry) => entry !== listener);
  };
};

const emit = (payload: ToastPayload): void => {
  if (listeners.length === 0) {
    pending.push(payload);
    return;
  }
  for (const listener of listeners) listener(payload);
};

export const toast = {
  success: (message: string) => emit({ message, variant: ToastVariants.SUCCESS }),
  error: (message: string) => emit({ message, variant: ToastVariants.ERROR }),
  info: (message: string) => emit({ message, variant: ToastVariants.INFO }),
  warn: (message: string) => emit({ message, variant: ToastVariants.WARN }),
};
