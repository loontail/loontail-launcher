import type { CatalogItem } from '@shared/contracts/catalog';
import { useMemo } from 'react';
import { renderBuildDescriptionMarkdown } from '../buildDescriptionMarkdown';

// Body only: every caller already renders the section heading above it.
export const BuildAbout = ({ item }: { item: CatalogItem }) => {
  const description = item.presentation.description;
  const parsed = useMemo(() => renderBuildDescriptionMarkdown(description ?? ''), [description]);

  if (!description) return null;

  return (
    <div
      className="prose prose-invert prose-sm max-w-none text-glass/60 [&_a]:text-glass/75 [&_h1]:text-glass/90 [&_h2]:text-glass/85 [&_h3]:text-glass/80 [&_img]:h-auto [&_img]:w-full [&_img]:rounded-lg [&_strong]:text-glass/80"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized markdown helper removes raw HTML and unsafe links
      dangerouslySetInnerHTML={{ __html: parsed }}
    />
  );
};
