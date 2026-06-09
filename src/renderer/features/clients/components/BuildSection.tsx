import type { ReactNode } from 'react';

export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
    {children}
  </p>
);

// A labelled content block used inside the detail modal body (gallery, servers,
// about, metadata) so every subsection shares the same heading treatment.
export const BuildSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section>
    <SectionLabel>{title}</SectionLabel>
    {children}
  </section>
);
