import { Button } from '@renderer/shared/ui/Button';
import { OverrideMark } from '@renderer/shared/ui/OverrideMark';
import { Skeleton } from '@renderer/shared/ui/Skeleton';
import { Slider } from '@renderer/shared/ui/Slider';
import { Loader2, MemoryStick } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type RamControlProps = {
  value: number;
  onChange: (value: number) => void;
  onSave: () => void;
  saved: number;
  range: number[];
  loading: boolean;
  saving: boolean;
  overridden?: boolean;
};

export const RamControl = ({
  value,
  onChange,
  onSave,
  saved,
  range,
  loading,
  saving,
  overridden = false,
}: RamControlProps) => {
  const { t } = useTranslation();

  const min = range[0] ?? 0;
  const max = range[range.length - 1] ?? min;
  const step = range.length > 1 ? (range[1] ?? min) - min : 1;
  const isDirty = value !== saved;

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-muted text-foreground">
          <MemoryStick className="size-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h4 className="text-sm font-semibold text-foreground">
            {t('settings.system.allocatedRam')}
            <OverrideMark shown={overridden} />
          </h4>
          <p className="text-xs text-muted-foreground">{t('settings.system.ramDesc')}</p>
        </div>
        <div className="flex w-24 shrink-0 flex-col items-stretch gap-2">
          {loading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <span className="flex h-8 items-center justify-center whitespace-nowrap rounded-sm border border-border bg-background px-3 text-sm font-medium tabular-nums">
              {value} MB
            </span>
          )}
          {loading ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            <Button size="sm" onClick={onSave} disabled={!isDirty || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : t('settings.system.save')}
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex h-4 items-center">
          {loading ? (
            <Skeleton className="h-1.5 w-full rounded-full" />
          ) : (
            <Slider value={value} onValueChange={onChange} min={min} max={max} step={step} />
          )}
        </div>
        <div className="flex h-4 items-center justify-between text-xs text-muted-foreground">
          {loading ? (
            <>
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-14" />
            </>
          ) : (
            <>
              <span>{min} MB</span>
              <span>{max} MB</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
