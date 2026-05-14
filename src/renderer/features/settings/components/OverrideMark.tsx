import type { ReactElement } from 'react';

type OverrideMarkProps = {
  shown: boolean;
};

export const OverrideMark = ({ shown }: OverrideMarkProps): ReactElement | null =>
  shown ? (
    <span aria-label="overridden" className="ml-1 text-primary">
      *
    </span>
  ) : null;
