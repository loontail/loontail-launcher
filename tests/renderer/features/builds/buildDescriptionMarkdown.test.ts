import { type CatalogItem, officialKey } from '@shared/contracts/catalog';
import type { Client } from '@shared/contracts/client';
import { asClientId, asClientSlug } from '@shared/contracts/ids';
import type { Media } from '@shared/contracts/media';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The allowlist is derived at module scope from the build-time env, so the
// configured origin has to be in place before the module is first imported.
vi.hoisted(() => {
  process.env.API_URL = 'https://api.test.invalid';
  process.env.DESCRIPTION_LINK_HOSTS = 'discord.gg, modrinth.com';
});

vi.mock('@renderer/features/minecraft', () => ({
  useClientStatus: () => ({ status: 'not-installed', paused: false }),
}));

vi.mock('@renderer/features/builds/components/PlayButton', () => ({
  PlayButton: () => null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const { renderBuildDescriptionMarkdown } = await import(
  '@renderer/features/builds/buildDescriptionMarkdown'
);
const { BuildAbout } = await import('@renderer/features/builds/components/BuildAbout');

// Re-imports the module against a different build-time env.
const withEnv = async (env: {
  apiUrl: string;
  extraHosts?: string;
}): Promise<(markdown: string) => string> => {
  const previousApiUrl = process.env.API_URL;
  const previousHosts = process.env.DESCRIPTION_LINK_HOSTS;
  process.env.API_URL = env.apiUrl;
  process.env.DESCRIPTION_LINK_HOSTS = env.extraHosts ?? '';
  vi.resetModules();
  try {
    const module = await import('@renderer/features/builds/buildDescriptionMarkdown');
    return module.renderBuildDescriptionMarkdown;
  } finally {
    process.env.API_URL = previousApiUrl;
    process.env.DESCRIPTION_LINK_HOSTS = previousHosts;
    vi.resetModules();
  }
};

const makeMedia = (id: number): Media => ({
  url: `https://api.test.invalid/uploads/media-${id}.webp`,
  width: 1280,
  height: 720,
});

const makeClient = (description: string): Client => ({
  id: asClientId('client-1'),
  slug: asClientSlug('loontail'),
  title: 'Loontail',
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
  titleImage: null,
  keywords: [],
});

const makeItem = (description: string): CatalogItem => {
  const client = makeClient(description);
  return {
    kind: 'official',
    key: officialKey(client.slug),
    ref: { source: 'official', slug: client.slug },
    spec: {
      minecraftVersion: '',
      forgeVersion: null,
      fabricVersion: null,
      runtimeVersion: null,
      bundleSlug: null,
    },
    presentation: {
      title: client.title,
      shortDescription: '',
      description,
      available: true,
      media: {
        poster: client.poster ? { url: client.poster.url } : null,
        background: client.background ? { url: client.background.url } : null,
        titleImage: null,
        screenshots: [],
      },
      servers: [],
      createdAt: '',
      updatedAt: '',
    },
    raw: client,
  };
};

describe('renderBuildDescriptionMarkdown', () => {
  it('renders ordinary markdown with safe external links', () => {
    const markdown = [
      '# About',
      'Welcome to **Loontail** with *modded* gameplay and `safe code`.',
      '- First feature',
      '- Second feature',
      '> Community server notes.',
      '[News](https://api.test.invalid/news "Read news")',
    ].join('\n\n');

    const rendered = renderBuildDescriptionMarkdown(markdown);

    expect(rendered).toContain('<h1>About</h1>');
    expect(rendered).toContain('<strong>Loontail</strong>');
    expect(rendered).toContain('<em>modded</em>');
    expect(rendered).toContain('<code>safe code</code>');
    expect(rendered).toContain('<ul>');
    expect(rendered).toContain('<blockquote>');
    expect(rendered).toContain(
      '<a href="https://api.test.invalid/news" title="Read news" target="_blank" rel="noreferrer noopener">News</a>',
    );
  });

  it('removes raw HTML, image tags, and unsafe URL protocols', () => {
    const markdown = [
      '<script>alert("xss")</script>',
      '<img src="https://api.test.invalid/x.png" onerror="alert(1)">',
      '<a href="https://api.test.invalid/news" onclick="alert(1)">raw link</a>',
      '[script link](javascript:alert(1))',
      '[file link](file:///C:/Users/secrets)',
      '![remote image](https://api.test.invalid/uploads/image.webp)',
    ].join('\n\n');

    const rendered = renderBuildDescriptionMarkdown(markdown);

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

  it('allows the configured API host, its subdomains, and the extra host list', () => {
    const markdown = [
      '[api](https://api.test.invalid/patch-notes)',
      '[subdomain](https://cdn.api.test.invalid/patch-notes)',
      '[extra](https://discord.gg/loontail)',
      '[extra2](https://modrinth.com/mod/x)',
      '[offsite](https://example.com/patch-notes)',
      '[http](http://api.test.invalid/patch-notes)',
    ].join('\n\n');

    const rendered = renderBuildDescriptionMarkdown(markdown);

    expect(rendered).toContain('href="https://api.test.invalid/patch-notes"');
    expect(rendered).toContain('href="https://cdn.api.test.invalid/patch-notes"');
    expect(rendered).toContain('href="https://discord.gg/loontail"');
    expect(rendered).toContain('href="https://modrinth.com/mod/x"');
    expect(rendered).not.toContain('href="https://example.com/patch-notes"');
    expect(rendered).not.toContain('href="http://api.test.invalid/patch-notes"');
    expect(rendered).toContain('offsite');
    expect(rendered).toContain('http');
  });

  it('keeps links for a differently configured API origin', async () => {
    const render = await withEnv({ apiUrl: 'https://cms.example.dev' });

    const rendered = render('[news](https://cms.example.dev/news)');

    expect(rendered).toContain('href="https://cms.example.dev/news"');
  });

  it('strips every link when no host is configured', async () => {
    const render = await withEnv({ apiUrl: '' });

    const rendered = render('[news](https://cms.example.dev/news)');

    expect(rendered).not.toContain('<a ');
    expect(rendered).toContain('news');
  });

  it('warns once at load when the allowlist resolves to nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withEnv({ apiUrl: '' });
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[0]).toContain('link allowlist is empty');

      warn.mockClear();
      await withEnv({ apiUrl: 'https://cms.example.dev' });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('does not turn a malformed API_URL into a wildcard allowlist', async () => {
    const render = await withEnv({ apiUrl: 'not a url', extraHosts: ' , ,' });

    const rendered = render('[anything](https://evil.example.com/x)');

    expect(rendered).not.toContain('<a ');
  });
});

describe('BuildAbout description rendering', () => {
  it('uses sanitized markdown for the renderer description surface', () => {
    const item = makeItem(
      [
        'Read [news](https://api.test.invalid/news).',
        '<script>alert("xss")</script>',
        '[bad](javascript:alert(1))',
      ].join('\n\n'),
    );

    const rendered = renderToStaticMarkup(createElement(BuildAbout, { item }));

    expect(rendered).toContain('href="https://api.test.invalid/news"');
    expect(rendered).toContain('target="_blank"');
    expect(rendered).toContain('rel="noreferrer noopener"');
    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('javascript:');
  });
});
