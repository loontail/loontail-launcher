import { type ToastPayload, subscribeToToasts, toast } from '@renderer/shared/ui/Toast/toast';
import { describe, expect, it, vi } from 'vitest';

const capture = (run: () => void): ToastPayload[] => {
  const received: ToastPayload[] = [];
  const unsubscribe = subscribeToToasts((payload) => received.push(payload));
  run();
  unsubscribe();
  return received;
};

describe('toast action support', () => {
  it('attaches the action when provided and omits it otherwise', () => {
    const onClick = vi.fn();
    const withAction = capture(() =>
      toast.error('Launch failed', { action: { label: 'Repair', onClick } }),
    );
    const withoutAction = capture(() => toast.error('Just info'));

    expect(withAction[0]?.action).toEqual({ label: 'Repair', onClick });
    expect('action' in (withoutAction[0] ?? {})).toBe(false);

    withAction[0]?.action?.onClick();
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
