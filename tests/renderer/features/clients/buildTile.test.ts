import type { CatalogItem } from '@shared/contracts/catalog';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/features/minecraft', () => ({
  useClientStatus: () => ({ status: 'installed', paused: false }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import { BuildTile } from '@renderer/features/clients/components/BuildTile';

const baseSpec = {
  minecraftVersion: '1.21.4',
  forgeVersion: null,
  fabricVersion: null,
  runtimeVersion: null,
  bundleSlug: null,
};

const officialItem = (): CatalogItem =>
  ({
    kind: 'official',
    key: 'official:survival',
    ref: { source: 'official', slug: 'survival' },
    spec: baseSpec,
    presentation: { title: 'Survival', shortDescription: '', description: '', available: true },
    raw: {
      poster: { url: 'https://cdn.example/poster.webp', name: 'poster', formats: {} },
      background: { url: 'https://cdn.example/bg.webp', name: 'bg', formats: {} },
      screenshots: [],
      keywords: [],
    },
  }) as unknown as CatalogItem;

const localItem = (): CatalogItem =>
  ({
    kind: 'local',
    key: 'local:550e8400-e29b-41d4-a716-446655440000',
    ref: { source: 'local', id: '550e8400-e29b-41d4-a716-446655440000' },
    spec: baseSpec,
    presentation: {
      title: 'Test Build',
      shortDescription: '',
      description: '',
      available: true,
      media: { poster: null, background: null, titleImage: null, screenshots: [] },
    },
  }) as unknown as CatalogItem;

const render = (item: CatalogItem): string =>
  renderToStaticMarkup(createElement(BuildTile, { item, onOpen: () => undefined }));

describe('BuildTile', () => {
  it('renders an official build with poster artwork, title, status and meta line', () => {
    const html = render(officialItem());
    expect(html).toContain('<img');
    expect(html).toContain('Survival');
    expect(html).toContain('clients.status.ready');
    // quiet meta line: MC version · loader (no metadata pills)
    expect(html).toContain('clients.versionChip.short');
    expect(html).toContain('clientSettings.loader.vanilla');
  });

  it('renders a local build with a generated fallback (no image) and its status', () => {
    const html = render(localItem());
    expect(html).not.toContain('<img');
    expect(html).toContain('clients.status.ready');
    // generated visual fallback instead of a poster image
    expect(html).toContain('linear-gradient');
  });

  // Source (local/official) is shown by the section heading, not repeated per card.
  it('does not render a source badge on the card', () => {
    expect(render(officialItem())).not.toContain('clients.badge.official');
    expect(render(localItem())).not.toContain('clients.badge.local');
  });
});
