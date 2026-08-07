import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import { CACHE_MEDIA_PREFIX } from '@shared/constants';
import { describe, expect, it } from 'vitest';

describe('toCachedMediaUrl', () => {
  it('wraps an https URL in the shared cache scheme', () => {
    const wrapped = toCachedMediaUrl('https://cdn.example.com/a b.png');

    expect(wrapped).toBe(
      `${CACHE_MEDIA_PREFIX}${encodeURIComponent('https://cdn.example.com/a b.png')}`,
    );
  });

  it('leaves non-http(s) URLs untouched', () => {
    expect(toCachedMediaUrl('file:///C:/skin.png')).toBe('file:///C:/skin.png');
    expect(toCachedMediaUrl('')).toBe('');
  });
});
