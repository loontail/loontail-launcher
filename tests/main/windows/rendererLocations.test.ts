import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RENDERER_ENTRY_FILES, createRendererLocation } from '@main/windows/rendererLocations';
import { describe, expect, it } from 'vitest';

const rendererRoot = join(process.cwd(), 'out', 'renderer');
const mainFileUrl = pathToFileURL(join(rendererRoot, RENDERER_ENTRY_FILES.Main)).href;
const consoleFileUrl = pathToFileURL(join(rendererRoot, RENDERER_ENTRY_FILES.Console)).href;
const arbitraryFileUrl = pathToFileURL(join(process.cwd(), 'outside.html')).href;

describe('createRendererLocation', () => {
  it('allows only the exact production main entry file', () => {
    const location = createRendererLocation({
      entryFile: RENDERER_ENTRY_FILES.Main,
      rendererRoot,
      devServerUrl: null,
    });

    expect(location.loadUrl).toBeNull();
    expect(location.filePath).toBe(join(rendererRoot, RENDERER_ENTRY_FILES.Main));
    expect(location.isAllowedUrl(mainFileUrl)).toBe(true);
    expect(location.isAllowedUrl(consoleFileUrl)).toBe(false);
    expect(location.isAllowedUrl(arbitraryFileUrl)).toBe(false);
    expect(
      location.isAllowedUrl(`${mainFileUrl}?next=${encodeURIComponent(arbitraryFileUrl)}`),
    ).toBe(false);
  });

  it('allows only the exact production console entry file', () => {
    const location = createRendererLocation({
      entryFile: RENDERER_ENTRY_FILES.Console,
      rendererRoot,
      devServerUrl: null,
    });

    expect(location.loadUrl).toBeNull();
    expect(location.filePath).toBe(join(rendererRoot, RENDERER_ENTRY_FILES.Console));
    expect(location.isAllowedUrl(consoleFileUrl)).toBe(true);
    expect(location.isAllowedUrl(mainFileUrl)).toBe(false);
    expect(location.isAllowedUrl(arbitraryFileUrl)).toBe(false);
  });

  it('allows only the configured dev origin and main entry paths', () => {
    const location = createRendererLocation({
      entryFile: RENDERER_ENTRY_FILES.Main,
      devServerUrl: 'http://localhost:5173/',
    });

    expect(location.loadUrl).toBe('http://localhost:5173/');
    expect(location.isAllowedUrl('http://localhost:5173/')).toBe(true);
    expect(location.isAllowedUrl('http://localhost:5173/index.html')).toBe(true);
    expect(location.isAllowedUrl('http://localhost:5173/console.html')).toBe(false);
    expect(location.isAllowedUrl('http://127.0.0.1:5173/')).toBe(false);
    expect(location.isAllowedUrl('https://localhost:5173/')).toBe(false);
  });

  it('allows only the configured dev origin and console entry path', () => {
    const location = createRendererLocation({
      entryFile: RENDERER_ENTRY_FILES.Console,
      devServerUrl: 'http://localhost:5173/',
    });

    expect(location.loadUrl).toBe('http://localhost:5173/console.html');
    expect(location.isAllowedUrl('http://localhost:5173/console.html')).toBe(true);
    expect(location.isAllowedUrl('http://localhost:5173/')).toBe(false);
    expect(location.isAllowedUrl('http://localhost:5173/index.html')).toBe(false);
    expect(location.isAllowedUrl('http://localhost:5173/console.html#log')).toBe(false);
  });
});
