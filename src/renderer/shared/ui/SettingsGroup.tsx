import { cn } from '@renderer/shared/lib/cn';
import type { ReactNode } from 'react';

const DEFAULT_FOOTER_CLASS = 'border-t border-border bg-background/40 px-4 py-3';

type SettingsGroupProps = {
  title?: string | undefined;
  // Optional content rendered on the right side of the header row — e.g. a
  // provider chip or a status badge. Only shown when there is a header (i.e.
  // when `title` is set OR `rightSlot` itself is non-null).
  rightSlot?: ReactNode | undefined;
  // Optional footer rendered under the body with a top divider. Use for
  // sticky toolbars; leave empty for the common case of a divided row list.
  footer?: ReactNode | undefined;
  // Override the body wrapper className. Defaults to `divide-y divide-border`
  // which matches stacked `SettingsRow`s; pass a custom layout class (e.g.
  // `p-5` with arbitrary internal markup) when the body isn't a row list.
  bodyClassName?: string | undefined;
  // Override the footer wrapper className. Defaults to a divider + tinted
  // strip with comfortable `py-3` padding. Pass a custom value when the
  // footer hosts compact controls that need tighter spacing.
  footerClassName?: string | undefined;
  children: ReactNode;
};

export const SettingsGroup = ({
  title,
  rightSlot,
  footer,
  bodyClassName = 'divide-y divide-border',
  footerClassName = DEFAULT_FOOTER_CLASS,
  children,
}: SettingsGroupProps) => {
  const hasHeader = title !== undefined || rightSlot !== undefined;
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      {hasHeader && (
        <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
          {title !== undefined ? (
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
