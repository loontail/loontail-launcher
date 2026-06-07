import { Skeleton } from '@renderer/shared/ui/Skeleton';
import { BuildGrid } from './BuildGrid';

type BuildGridSkeletonProps = {
  count?: number;
};

export const BuildGridSkeleton = ({ count = 6 }: BuildGridSkeletonProps) => (
  <BuildGrid>
    {Array.from({ length: count }).map((_, index) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: skeletons have no identity
      <Skeleton key={index} className="h-18 w-full rounded-lg" />
    ))}
  </BuildGrid>
);
