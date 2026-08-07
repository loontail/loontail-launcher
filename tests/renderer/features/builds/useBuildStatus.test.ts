import { describeBuildStatus } from '@renderer/features/builds/components/buildStatus';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const GLYPHS = new Set(['installed', 'update', 'download', 'busy', 'error']);

describe('describeBuildStatus', () => {
  it('maps every install status to a status i18n key and a known glyph', () => {
    for (const status of Object.values(InstallStatuses)) {
      const view = describeBuildStatus(status);
      expect(view.labelKey.startsWith('builds.status.')).toBe(true);
      expect(GLYPHS.has(view.glyph)).toBe(true);
    }
  });

  it('maps installed → ready and error → error', () => {
    expect(describeBuildStatus(InstallStatuses.INSTALLED)).toEqual({
      labelKey: 'builds.status.ready',
      glyph: 'installed',
    });
    expect(describeBuildStatus(InstallStatuses.ERROR)).toEqual({
      labelKey: 'builds.status.error',
      glyph: 'error',
    });
  });
});
