type OverrideMarkProps = {
  shown: boolean;
};

export const OverrideMark = ({ shown }: OverrideMarkProps) =>
  shown ? (
    <span aria-label="overridden" className="ml-1 text-primary">
      *
    </span>
  ) : null;
