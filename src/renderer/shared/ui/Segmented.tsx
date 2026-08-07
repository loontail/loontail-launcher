import { cn } from '@renderer/shared/lib/cn';
import type { LucideIcon } from 'lucide-react';

export type SegmentedOption<T extends string> = {
  value: T;
  label?: string;
  icon?: LucideIcon;
  ariaLabel?: string;
};

type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'default';
  ariaLabel?: string;
  className?: string;
};

export const Segmented = <T extends string>({
  options,
  value,
  onChange,
  size = 'default',
  ariaLabel,
  className,
}: SegmentedProps<T>) => (
  <div
    role="radiogroup"
    aria-label={ariaLabel}
    className={cn(
      'inline-flex items-center gap-1 rounded-md border border-edge-md bg-surface-2 p-1',
      className,
    )}
  >
    {options.map((option) => {
      const Icon = option.icon;
      const active = option.value === value;
      const iconOnly = !option.label && Boolean(Icon);
      return (
        // biome-ignore lint/a11y/useSemanticElements: styled segment, not a native radio input
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active}
          aria-label={option.ariaLabel ?? option.label}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-sm font-semibold transition-colors duration-150 ease-standard',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
            size === 'sm' ? 'h-7 text-caption' : 'h-8 text-body',
            !iconOnly && 'px-3',
            iconOnly && (size === 'sm' ? 'w-7' : 'w-8'),
            active
              ? 'bg-cta text-on-cta shadow-sm'
              : 'text-text-mute hover:bg-ghost-hover hover:text-text',
          )}
        >
          {Icon && <Icon className="size-4" strokeWidth={2} aria-hidden />}
          {option.label}
        </button>
      );
    })}
  </div>
);
