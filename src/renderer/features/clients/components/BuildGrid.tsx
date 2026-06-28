import { RovingGroup } from '@renderer/shared/ui/RovingGroup';
import type { ReactNode } from 'react';
import type { BuildViewMode } from './viewMode';

type BuildGridProps = {
  children: ReactNode;
  variant?: BuildViewMode;
  roving?: boolean;
  resetKey?: unknown;
};

const LIST_CLASS = 'flex flex-col gap-2';
const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(13.5rem,1fr))] gap-4';

export const BuildGrid = ({ children, variant = 'grid', roving, resetKey }: BuildGridProps) => {
  const className = variant === 'list' ? LIST_CLASS : GRID_CLASS;
  if (roving) {
    return (
      <RovingGroup className={className} resetKey={resetKey}>
        {children}
      </RovingGroup>
    );
  }
  return <div className={className}>{children}</div>;
};
