import { Skeleton } from '@renderer/shared/ui/Skeleton';
import { BuildGrid } from './BuildGrid';

type BuildGridSkeletonProps = {
  count?: number;
};

export const BuildGridSkeleton = ({ count = 8 }: BuildGridSkeletonProps) => (
  <BuildGrid>
    {Array.from({ length: count }).map((_, index) => (
      <div
        // biome-ignore lint/suspicious/noArrayIndexKey: skeletons have no identity
        key={index}
        className="flex flex-col overflow-hidden rounded-lg border border-edge bg-surface-1"
      >
        <Skeleton className="aspect-video w-full rounded-none" />
        <div className="flex flex-col gap-2 p-3">
          <Skeleton className="h-3.5 w-3/4 rounded-sm" />
          <Skeleton className="h-3 w-1/2 rounded-sm" />
        </div>
      </div>
    ))}
  </BuildGrid>
);
