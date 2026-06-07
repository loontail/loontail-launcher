import { cn } from '@renderer/shared/lib/cn';
import { Button } from '@renderer/shared/ui/Button';
import { ClipboardCopy, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { COPY_FEEDBACKS, type CopyFeedback, copyFeedbackLabel } from './format';

type ConsoleDetailPanelProps = {
  lineText: string;
  copyLineFeedback: CopyFeedback;
  onCopyLine: () => Promise<void>;
  onClose: () => void;
};

export const ConsoleDetailPanel = ({
  lineText,
  copyLineFeedback,
  onCopyLine,
  onClose,
}: ConsoleDetailPanelProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex max-h-[30%] flex-col border-t border-edge bg-surface-0/60">
      <div className="flex items-center justify-between border-b border-edge px-4 py-2">
        <span className="text-eyebrow font-bold uppercase tracking-eyebrow text-glass/55">
          {t('console.detailHeader')}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void onCopyLine()}
            data-feedback={copyLineFeedback === COPY_FEEDBACKS.IDLE ? undefined : copyLineFeedback}
            className={cn(
              copyLineFeedback === COPY_FEEDBACKS.SUCCESS && 'border-success/40 text-success',
              copyLineFeedback === COPY_FEEDBACKS.ERROR && 'border-destructive/50 text-destructive',
            )}
          >
            <ClipboardCopy className="size-3.5" />
            {copyFeedbackLabel(copyLineFeedback, t('console.copyLine'), t)}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="size-3.5" />
            {t('console.detailClose')}
          </Button>
        </div>
      </div>
      <pre className="console-mono selectable flex-1 overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-caption leading-snug">
        {lineText}
      </pre>
    </div>
  );
};
