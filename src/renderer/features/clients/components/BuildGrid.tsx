import { RovingGroup } from '@renderer/shared/ui/RovingGroup';
import type { ReactNode } from 'react';
import type { BuildViewMode } from './viewMode';

type BuildGridProps = {
  children: ReactNode;
  variant?: BuildViewMode;
  // When true the grid is a single roving-tabindex group (one tab stop, arrow
  // navigation). `resetKey` re-evaluates descendants after the set changes.
  roving?: boolean;
  resetKey?: unknown;
};

const LIST_CLASS = 'flex flex-col gap-2';
const GRID_CLASS = 'grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3';

// Catalog layout: grid mode auto-fills poster cards with a sensible min width;
// list mode stacks compact rows.
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
