import type { CatalogItem } from '@shared/contracts/catalog';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { renderClientDescriptionMarkdown } from '../clientDescriptionMarkdown';
import { SectionLabel } from './BuildSection';

export const BuildAbout = ({ item }: { item: CatalogItem }) => {
  const { t } = useTranslation();
  const description = item.presentation.description;
  const parsed = useMemo(() => renderClientDescriptionMarkdown(description ?? ''), [description]);

  if (!description) return null;

  return (
    <section>
      <SectionLabel>{t('clients.about')}</SectionLabel>
      <div
        className="prose prose-invert prose-sm max-w-none text-glass/60 [&_a]:text-glass/75 [&_h1]:text-glass/90 [&_h2]:text-glass/85 [&_h3]:text-glass/80 [&_img]:h-auto [&_img]:w-full [&_img]:rounded-lg [&_strong]:text-glass/80"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized markdown helper removes raw HTML and unsafe links
        dangerouslySetInnerHTML={{ __html: parsed }}
      />
    </section>
  );
};
