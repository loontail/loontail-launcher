import { cn } from '@renderer/shared/lib/cn';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

type Variant = 'solid' | 'soft' | 'outline';

type BadgeProps = {
  children: ReactNode;
  variant?: Variant;
  icon?: LucideIcon;
  className?: string | undefined;
};

// Small monochrome label pill. `solid` sits over key-art (opaque dark fill — no
// blur, so it's safe on the scrolling catalog), `soft` sits on an opaque surface,
// `outline` is the quietest (tags/keywords).
const variantClasses: Record<Variant, string> = {
  solid: 'border border-edge bg-overlay/70 text-text-hi',
  soft: 'border border-edge bg-surface-2 text-text',
  outline: 'border border-edge text-text-mute',
};

export const Badge = ({ children, variant = 'soft', icon: Icon, className }: BadgeProps) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-caption font-semibold leading-none',
      variantClasses[variant],
      className,
    )}
  >
    {Icon && <Icon className="size-3" strokeWidth={2.25} aria-hidden />}
    {children}
  </span>
);
