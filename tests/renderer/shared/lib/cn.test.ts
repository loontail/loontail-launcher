import { cn } from '@renderer/shared/lib/cn';
import { describe, expect, it } from 'vitest';

describe('cn', () => {
  it('merges conflicting utilities from the same group, keeping the last', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4');
    expect(cn('text-body', 'text-h1')).toBe('text-h1');
  });

  it('keeps a custom text-* size token alongside a text-* colour token', () => {
    // The two live in different tailwind-merge class groups only because cn()
    // registers the design-system size tokens under `font-size`; without that the
    // size silently loses to the colour.
    expect(cn('text-body', 'text-text-mute')).toBe('text-body text-text-mute');
    expect(cn('text-caption', 'text-cta')).toBe('text-caption text-cta');
    expect(cn('text-progress-label', 'text-glass/85')).toBe('text-progress-label text-glass/85');
  });

  it('drops falsy clsx inputs', () => {
    expect(cn('flex', false, undefined, null, 'gap-2')).toBe('flex gap-2');
  });
});
