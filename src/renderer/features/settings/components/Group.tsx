import type { ReactNode } from 'react';

type GroupProps = {
  title?: string | undefined;
  children: ReactNode;
};

export const Group = ({ title, children }: GroupProps) => (
  <section className="overflow-hidden rounded-md border border-border bg-card">
    {title !== undefined && (
      <h2 className="border-b border-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
    )}
    <div className="divide-y divide-border">{children}</div>
  </section>
);
