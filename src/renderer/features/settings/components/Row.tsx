import { cn } from '@renderer/shared/lib/cn';
import { Switch } from '@renderer/shared/ui/Switch';
import type { ReactElement, ReactNode } from 'react';

type RowProps = {
  label: ReactNode;
  description?: ReactNode | undefined;
  right?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
};

export const Row = ({ label, description, right, onClick }: RowProps): ReactElement => {
  const interactive = typeof onClick === 'function';
  const content = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        {description !== undefined && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      {right !== undefined && <div className="shrink-0">{right}</div>}
    </>
  );

  if (interactive) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors',
          'hover:bg-muted focus:outline-none focus-visible:bg-muted',
        )}
      >
        {content}
      </button>
    );
  }

  return <div className="flex items-center justify-between gap-4 px-4 py-3">{content}</div>;
};

type SwitchRowProps = {
  label: ReactNode;
  description?: ReactNode | undefined;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
};

export const SwitchRow = ({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SwitchRowProps): ReactElement => {
  const isDisabled = disabled === true;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={isDisabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors',
        'hover:bg-muted focus:outline-none focus-visible:bg-muted',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-foreground">{label}</span>
        {description !== undefined && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </div>
      <div className="shrink-0">
        <Switch checked={checked} disabled={isDisabled} />
      </div>
    </button>
  );
};
