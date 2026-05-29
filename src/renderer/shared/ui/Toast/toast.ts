export const ToastVariants = {
  SUCCESS: 'success',
  ERROR: 'error',
  INFO: 'info',
  WARN: 'warn',
} as const;

export type ToastVariant = (typeof ToastVariants)[keyof typeof ToastVariants];

// Optional inline call-to-action (e.g. "Repair"). When present, the toast does
// not auto-dismiss — the user must act on or dismiss it.
export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastPayload = {
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
};

export type ToastOptions = {
  action?: ToastAction;
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

const withVariant = (
  message: string,
  variant: ToastVariant,
  options?: ToastOptions,
): ToastPayload => ({
  message,
  variant,
  ...(options?.action ? { action: options.action } : {}),
});

export const toast = {
  success: (message: string, options?: ToastOptions) =>
    emit(withVariant(message, ToastVariants.SUCCESS, options)),
  error: (message: string, options?: ToastOptions) =>
    emit(withVariant(message, ToastVariants.ERROR, options)),
  info: (message: string, options?: ToastOptions) =>
    emit(withVariant(message, ToastVariants.INFO, options)),
  warn: (message: string, options?: ToastOptions) =>
    emit(withVariant(message, ToastVariants.WARN, options)),
};
