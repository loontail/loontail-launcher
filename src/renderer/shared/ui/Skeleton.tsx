import { cn } from '@renderer/shared/lib/cn';
import type { HTMLAttributes } from 'react';

type SkeletonProps = HTMLAttributes<HTMLDivElement>;

export const Skeleton = ({ className, ...rest }: SkeletonProps) => (
  <div className={cn('animate-pulse rounded-sm bg-muted', className)} {...rest} />
);
