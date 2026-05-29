import { renderClientDescriptionMarkdown } from '@renderer/features/clients/clientDescriptionMarkdown';
import { ClientOverview } from '@renderer/features/clients/components/ClientOverview';
import type { Client } from '@shared/contracts/client';
import { asClientId, asClientSlug } from '@shared/contracts/ids';
import type { StrapiMedia } from '@shared/contracts/strapi';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/features/minecraft', () => ({
  useClientStatus: () => ({ status: 'not-installed', paused: false }),
}));

vi.mock('@renderer/features/clients/components/PlayButton', () => ({
  PlayButton: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const makeMedia = (id: number): StrapiMedia => ({
  id,
  documentId: `media-${id}`,
  createdAt: '2026-05-29T00:00:00.000Z',
  updatedAt: '2026-05-29T00:00:00.000Z',
  publishedAt: '2026-05-29T00:00:00.000Z',
  url: `https://api.elixir.tld/uploads/media-${id}.webp`,
  ext: '.webp',
  width: 1280,
  height: 720,
  size: 24,
  name: `media-${id}.webp`,
  hash: `media-${id}`,
  formats: {},
});

const makeClient = (description: string): Client => ({
  id: asClientId(1),
  documentId: 'client-1',
  createdAt: '2026-05-29T00:00:00.000Z',
  updatedAt: '2026-05-29T00:00:00.000Z',
  publishedAt: '2026-05-29T00:00:00.000Z',
  slug: asClientSlug('elixir'),
  title: 'Elixir',
  description,
  shortDescription: '',
  available: true,
  minecraftVersion: '',
  forgeVersion: null,
  fabricVersion: null,
  runtimeVersion: null,
  bundleSlug: null,
  servers: [],
  screenshots: [],
  background: makeMedia(1),
  poster: makeMedia(2),
  keywords: [],
});

describe('renderClientDescriptionMarkdown', () => {
  it('renders ordinary markdown with safe external links', () => {
    const markdown = [
      '# About',
      'Welcome to **Elixir** with *modded* gameplay and `safe code`.',
      '- First feature',
      '- Second feature',
      '> Community server notes.',
      '[News](https://api.elixir.tld/news "Read news")',
    ].join('\n\n');

    const rendered = renderClientDescriptionMarkdown(markdown);

    expect(rendered).toContain('<h1>About</h1>');
    expect(rendered).toContain('<strong>Elixir</strong>');
    expect(rendered).toContain('<em>modded</em>');
    expect(rendered).toContain('<code>safe code</code>');
    expect(rendered).toContain('<ul>');
    expect(rendered).toContain('<blockquote>');
    expect(rendered).toContain(
      '<a href="https://api.elixir.tld/news" title="Read news" target="_blank" rel="noreferrer noopener">News</a>',
    );
  });

  it('removes raw HTML, image tags, and unsafe URL protocols', () => {
    const markdown = [
      '<script>alert("xss")</script>',
      '<img src="https://api.elixir.tld/x.png" onerror="alert(1)">',
      '<a href="https://api.elixir.tld/news" onclick="alert(1)">raw link</a>',
      '[script link](javascript:alert(1))',
      '[file link](file:///C:/Users/secrets)',
      '![remote image](https://api.elixir.tld/uploads/image.webp)',
    ].join('\n\n');

    const rendered = renderClientDescriptionMarkdown(markdown);

    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('<img');
    expect(rendered).not.toContain('onerror');
    expect(rendered).not.toContain('onclick');
    expect(rendered).not.toContain('javascript:');
    expect(rendered).not.toContain('file:');
    expect(rendered).toContain('raw link');
    expect(rendered).toContain('script link');
    expect(rendered).toContain('file link');
    expect(rendered).toContain('remote image');
  });

  it('allows only explicitly approved https hosts', () => {
    const markdown = [
      '[allowed](https://cdn.api.elixir.tld/patch-notes)',
      '[offsite](https://example.com/patch-notes)',
      '[http](http://api.elixir.tld/patch-notes)',
    ].join('\n\n');

    const rendered = renderClientDescriptionMarkdown(markdown);

    expect(rendered).toContain('href="https://cdn.api.elixir.tld/patch-notes"');
    expect(rendered).not.toContain('href="https://example.com/patch-notes"');
    expect(rendered).not.toContain('href="http://api.elixir.tld/patch-notes"');
    expect(rendered).toContain('offsite');
    expect(rendered).toContain('http');
  });
});

describe('ClientOverview description rendering', () => {
  it('uses sanitized markdown for the renderer description surface', () => {
    const client = makeClient(
      [
        'Read [news](https://api.elixir.tld/news).',
        '<script>alert("xss")</script>',
        '[bad](javascript:alert(1))',
      ].join('\n\n'),
    );

    const rendered = renderToStaticMarkup(createElement(ClientOverview, { client }));

    expect(rendered).toContain('href="https://api.elixir.tld/news"');
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain('rel="noreferrer noopener"');
    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('javascript:');
  });
});
