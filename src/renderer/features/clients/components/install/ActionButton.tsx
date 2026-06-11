import { cn } from '@renderer/shared/lib/cn';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

// `primary` is the white CTA. `muted` is the neutral secondary (Stop, Cancel,
// Launching) — monochrome, no chromatic/destructive hue. `ghost` is the quiet
// inline control (Pause/Resume). `danger` is kept as a name-compatible alias of
// `muted` plus a stronger outline so cancel reads as the heavier neutral action.
export type ActionVariant = 'primary' | 'muted' | 'ghost' | 'danger';

export type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ActionVariant;
};

const VARIANT_CLASSES: Record<ActionVariant, string> = {
  primary:
    'h-11 min-w-35 rounded-full px-6 text-body-med bg-cta text-on-cta ' +
    'shadow-[inset_0_1px_0_var(--shadow-inset-highlight)] ' +
    'hover:bg-cta-hover active:bg-cta-press motion-safe:active:scale-[0.98]',
  muted:
    'h-11 min-w-35 px-6 text-body-med bg-surface-2 text-glass ' +
    'shadow-[inset_0_1px_0_var(--shadow-inset-highlight)] ' +
    'hover:bg-surface-3 motion-safe:active:scale-[0.98]',
  ghost:
    'h-9 px-4 text-caption border border-edge-md bg-ghost text-glass/75 ' +
    'hover:border-edge-xl hover:bg-ghost-hover hover:text-glass motion-safe:active:scale-[0.98]',
  danger:
    'h-9 px-4 text-caption border border-edge-lg bg-surface-2 text-glass/80 ' +
    'hover:border-edge-xl hover:bg-surface-3 hover:text-glass motion-safe:active:scale-[0.98]',
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(
  ({ className, variant = 'primary', type = 'button', children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-bold transition-all duration-150 ease-standard',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANT_CLASSES[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  ),
);
ActionButton.displayName = 'ActionButton';
