import { describeBuildStatus } from '@renderer/features/clients/components/buildStatus';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const TONES = new Set(['ready', 'active', 'pending', 'idle', 'error']);
const GLYPHS = new Set(['installed', 'update', 'download', 'busy', 'error']);

describe('describeBuildStatus', () => {
  it('maps every install status to a status i18n key, a known tone and a known glyph', () => {
    for (const status of Object.values(InstallStatuses)) {
      const view = describeBuildStatus(status);
      expect(view.labelKey.startsWith('clients.status.')).toBe(true);
      expect(TONES.has(view.tone)).toBe(true);
      expect(GLYPHS.has(view.glyph)).toBe(true);
    }
  });

  it('maps installed → ready and error → error', () => {
    expect(describeBuildStatus(InstallStatuses.INSTALLED)).toEqual({
      labelKey: 'clients.status.ready',
      tone: 'ready',
      glyph: 'installed',
    });
    expect(describeBuildStatus(InstallStatuses.ERROR)).toEqual({
      labelKey: 'clients.status.error',
      tone: 'error',
      glyph: 'error',
    });
  });
});
