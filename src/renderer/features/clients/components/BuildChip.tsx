import { cn } from '@renderer/shared/lib/cn';
import type { ReactNode } from 'react';

type ChipVariant = 'version' | 'loader' | 'keyword';

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  version: 'border-edge-md bg-chip-dark font-semibold text-glass/85',
  loader: 'border-edge bg-chip font-medium text-glass/55',
  keyword: 'border-edge bg-chip font-medium text-glass/55',
};

type BuildChipProps = {
  variant?: ChipVariant;
  className?: string;
  children: ReactNode;
};

// The one canonical metadata chip used in the detail hero, sized to match the
// established launcher look. Text never wraps; long values ellipsize.
export const BuildChip = ({ variant = 'loader', className, children }: BuildChipProps) => (
  <span
    className={cn(
      'inline-flex max-w-full items-center truncate whitespace-nowrap rounded-full border px-2.5 py-1 text-eyebrow leading-none tracking-wide backdrop-blur-sm',
      VARIANT_CLASSES[variant],
      className,
    )}
  >
    {children}
  </span>
);
