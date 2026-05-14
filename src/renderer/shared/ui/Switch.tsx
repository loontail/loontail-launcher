import { cn } from '@renderer/shared/lib/cn';

type SwitchProps = {
  checked?: boolean;
  disabled?: boolean;
};

export const Switch = ({ checked = false, disabled = false }: SwitchProps) => (
  <span
    aria-hidden
    className={cn(
      'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors',
      checked ? 'bg-primary' : 'bg-input',
      disabled && 'opacity-50',
    )}
  >
    <span
      className={cn(
        'pointer-events-none ml-0.5 inline-block size-4 rounded-full bg-background transition-transform',
        checked ? 'translate-x-4' : 'translate-x-0',
      )}
    />
  </span>
);
