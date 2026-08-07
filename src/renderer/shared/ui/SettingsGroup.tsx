import { cn } from '@renderer/shared/lib/cn';
import type { ReactNode } from 'react';

const DEFAULT_FOOTER_CLASS = 'border-t border-edge bg-canvas/40 px-4 py-3';

type SettingsGroupProps = {
  title?: string | undefined;
  // Header right slot; only rendered when there is a header (title or rightSlot set).
  rightSlot?: ReactNode | undefined;
  footer?: ReactNode | undefined;
  bodyClassName?: string | undefined;
  footerClassName?: string | undefined;
  children: ReactNode;
};

export const SettingsGroup = ({
  title,
  rightSlot,
  footer,
  bodyClassName = 'divide-y divide-edge',
  footerClassName = DEFAULT_FOOTER_CLASS,
  children,
}: SettingsGroupProps) => {
  const hasHeader = title !== undefined || rightSlot !== undefined;
  return (
    <section className="overflow-hidden rounded-md border border-edge bg-surface-1">
      {hasHeader && (
        <div className="flex items-center justify-between gap-4 border-b border-edge px-4 py-3">
          {title !== undefined ? (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-text-mute">
              {title}
            </h2>
          ) : (
            <span />
          )}
          {rightSlot}
        </div>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
      {footer !== undefined && <div className={cn(footerClassName)}>{footer}</div>}
    </section>
  );
};
