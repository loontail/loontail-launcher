import { cn } from '@renderer/shared/lib/cn';
import type { ReactNode } from 'react';

type SectionHeadingProps = {
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
};

export const SectionHeading = ({ children, aside, className }: SectionHeadingProps) => (
  <div className={cn('mb-3 flex items-center justify-between gap-3', className)}>
    <h2 className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
      {children}
    </h2>
    {aside}
  </div>
);
