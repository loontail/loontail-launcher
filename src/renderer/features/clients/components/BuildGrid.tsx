import type { ReactNode } from 'react';

type BuildGridProps = {
  children: ReactNode;
};

// Responsive auto-filling grid of compact client cards: rows keep a sensible min
// width and reflow from a single column on a narrow window up to as many as fit
// on a wide one.
export const BuildGrid = ({ children }: BuildGridProps) => (
  <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-2.5">{children}</div>
);
