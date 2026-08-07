type OverrideMarkProps = {
  shown: boolean;
};

export const OverrideMark = ({ shown }: OverrideMarkProps) =>
  shown ? (
    <span role="img" aria-label="overridden" className="ml-1 text-cta">
      *
    </span>
  ) : null;
