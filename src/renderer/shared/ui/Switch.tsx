import { cn } from '@renderer/shared/lib/cn';
import type { KeyboardEvent } from 'react';

type SwitchProps = {
  checked?: boolean;
  disabled?: boolean;
  // When omitted, the switch is decorative and the surrounding control owns the
  // accessible role/state.
  onCheckedChange?: ((value: boolean) => void) | undefined;
  label?: string | undefined;
};

export const Switch = ({
  checked = false,
  disabled = false,
  onCheckedChange,
  label,
}: SwitchProps) => {
  const interactive = typeof onCheckedChange === 'function';

  const toggle = () => {
    if (!disabled) onCheckedChange?.(!checked);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      toggle();
    }
  };

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: role and the aria-* props are gated on the same `interactive` flag, so aria-checked never ships without role="switch"
    <span
      role={interactive ? 'switch' : undefined}
      aria-hidden={interactive ? undefined : true}
      aria-checked={interactive ? checked : undefined}
      aria-disabled={interactive && disabled ? true : undefined}
      aria-label={interactive ? label : undefined}
      tabIndex={interactive && !disabled ? 0 : undefined}
      onClick={interactive ? toggle : undefined}
      onKeyDown={interactive ? onKeyDown : undefined}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
        checked ? 'bg-cta' : 'bg-edge-md',
        disabled && 'opacity-50',
        interactive &&
          'cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        interactive && disabled && 'cursor-not-allowed',
      )}
    >
      <span
        className={cn(
          'pointer-events-none ml-0.5 inline-block size-4 rounded-full bg-canvas transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </span>
  );
};
