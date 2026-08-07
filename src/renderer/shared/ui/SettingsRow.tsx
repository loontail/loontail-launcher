import { cn } from '@renderer/shared/lib/cn';
import { Switch } from '@renderer/shared/ui/Switch';
import type { ReactNode } from 'react';

type SettingsRowProps = {
  label: ReactNode;
  description?: ReactNode | undefined;
  right?: ReactNode | undefined;
  onClick?: (() => void) | undefined;
};

export const SettingsRow = ({ label, description, right, onClick }: SettingsRowProps) => {
  const interactive = typeof onClick === 'function';
  const content = (
    <>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-text-hi">{label}</span>
        {description !== undefined && <span className="text-xs text-text-mute">{description}</span>}
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
          'hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2',
        )}
      >
        {content}
      </button>
    );
  }

  return <div className="flex items-center justify-between gap-4 px-4 py-3">{content}</div>;
};

type SettingsSwitchRowProps = {
  label: ReactNode;
  description?: ReactNode | undefined;
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
};

export const SettingsSwitchRow = ({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: SettingsSwitchRowProps) => {
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
        'hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent',
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm text-text-hi">{label}</span>
        {description !== undefined && <span className="text-xs text-text-mute">{description}</span>}
      </div>
      <div className="shrink-0">
        <Switch checked={checked} disabled={isDisabled} />
      </div>
    </button>
  );
};
