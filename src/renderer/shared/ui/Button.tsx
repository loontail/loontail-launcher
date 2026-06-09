import { cn } from '@renderer/shared/lib/cn';
import type { ButtonHTMLAttributes } from 'react';

type Variant = 'default' | 'secondary' | 'destructive' | 'outline' | 'ghost';
type Size = 'default' | 'sm' | 'lg' | 'icon';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const variantClasses: Record<Variant, string> = {
  default:
    'bg-cta text-on-cta hover:bg-cta-hover active:bg-cta-press disabled:bg-surface-2 disabled:text-text-faint disabled:opacity-100',
  secondary:
    'border border-edge-md bg-surface-2 text-text hover:border-edge-lg hover:bg-surface-3 hover:text-text-hi disabled:opacity-50',
  destructive:
    'bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50',
  outline: 'border border-input bg-muted text-foreground hover:bg-secondary disabled:opacity-50',
  ghost: 'bg-transparent text-foreground hover:bg-muted disabled:opacity-50',
};

const sizeClasses: Record<Size, string> = {
  default: 'h-9 px-4 text-body',
  sm: 'h-8 px-3 text-caption',
  lg: 'h-11 px-5 text-body',
  icon: 'size-9 p-0',
};

export const Button = ({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...rest
}: ButtonProps) => (
  <button
    type={type}
    className={cn(
      'inline-flex cursor-pointer items-center justify-center gap-2 rounded-md font-semibold transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
      'disabled:pointer-events-none',
      variantClasses[variant],
      sizeClasses[size],
      className,
    )}
    {...rest}
  />
);
