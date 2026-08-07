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

// Stub the bundled PNG backdrops so the test doesn't pull asset modules through Vite.
vi.mock('@renderer/features/builds/components/localBackgrounds', () => ({
  localBackgroundFor: () => 'mock-bg.png',
}));

import { BuildCard } from '@renderer/features/builds/components/BuildCard';

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
    ref: { source: 'official', key: 'survival' },
    spec: baseSpec,
    presentation: { title: 'Survival', shortDescription: '', description: '', available: true },
    raw: {
      poster: { url: 'https://cdn.example/poster.webp', width: null, height: null },
      background: { url: 'https://cdn.example/bg.webp', width: null, height: null },
      titleImage: null,
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
  renderToStaticMarkup(createElement(BuildCard, { item, onOpen: () => undefined }));

describe('BuildCard', () => {
  it('renders an official build with key-art, title, status and a meta line', () => {
    const html = render(officialItem());
    expect(html).toContain('<img');
    expect(html).toContain('Survival');
    expect(html).toContain('builds.status.ready');
    expect(html).toContain('builds.versionChip.short');
    expect(html).toContain('buildSettings.loader.vanilla');
    expect(html).not.toContain('builds.mineBadge');
  });

  it('renders a local build over a seeded backdrop, with its status (no "Mine" tag)', () => {
    const html = render(localItem());
    expect(html).toContain('Test Build');
    expect(html).not.toContain('builds.mineBadge');
    expect(html).toContain('builds.status.ready');
    expect(html).toContain('mock-bg.png');
  });
});
