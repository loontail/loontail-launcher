import { cn } from '@renderer/shared/lib/cn';
import type { ButtonHTMLAttributes, ReactElement } from 'react';

type Variant = 'default' | 'destructive' | 'outline' | 'ghost';
type Size = 'default' | 'sm';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

const variantClasses: Record<Variant, string> = {
  default: 'bg-primary text-primary-foreground hover:bg-primary/90',
  destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
  outline: 'border border-input bg-muted text-foreground hover:bg-secondary',
  ghost: 'bg-transparent text-foreground hover:bg-muted',
};

const sizeClasses: Record<Size, string> = {
  default: 'h-9 px-4 text-sm',
  sm: 'h-8 px-3 text-xs',
};

export const Button = ({
  className,
  variant = 'default',
  size = 'default',
  type = 'button',
  ...rest
}: ButtonProps): ReactElement => (
  <button
    type={type}
    className={cn(
      'inline-flex items-center justify-center gap-2 rounded-sm font-medium transition-colors',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
      'disabled:pointer-events-none disabled:opacity-50',
      variantClasses[variant],
      sizeClasses[size],
      className,
    )}
    {...rest}
  />
);
