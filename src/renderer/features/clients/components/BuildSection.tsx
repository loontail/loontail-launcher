import type { ReactNode } from 'react';

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
    {children}
  </p>
);
