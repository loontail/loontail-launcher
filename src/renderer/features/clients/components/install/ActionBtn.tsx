import { cn } from '@renderer/shared/lib/cn';
import { type ButtonHTMLAttributes, forwardRef } from 'react';

export type ActionVariant = 'primary' | 'ghost' | 'danger';

export type ActionBtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ActionVariant };

const VARIANT_CLASSES: Record<ActionVariant, string> = {
  primary:
    'h-12 min-w-[140px] px-7 text-[14px] tracking-wide bg-primary text-primary-foreground ' +
    'shadow-[0_8px_24px_-6px_var(--color-glow-overlay-md)] ' +
    'hover:scale-[1.02] hover:shadow-[0_10px_28px_-6px_var(--color-glow-overlay-lg)] active:scale-[0.97]',
  ghost:
    'h-9 px-4 text-caption border border-edge-md bg-ghost text-glass/75 ' +
    'hover:border-edge-xl hover:bg-ghost-hover hover:text-glass active:scale-[0.97]',
  danger:
    'h-9 px-4 text-caption border border-destructive/30 bg-destructive/10 text-destructive/85 ' +
    'hover:border-destructive/40 hover:bg-destructive/15 hover:text-destructive active:scale-[0.97]',
};

export const ActionBtn = forwardRef<HTMLButtonElement, ActionBtnProps>(
  ({ className, variant = 'primary', type = 'button', children, ...rest }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-full font-bold transition-all duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/40 focus-visible:ring-offset-0',
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
ActionBtn.displayName = 'ActionBtn';
