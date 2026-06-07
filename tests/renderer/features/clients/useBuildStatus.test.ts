import { describeBuildStatus } from '@renderer/features/clients/components/buildStatus';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const TONES = new Set(['ready', 'active', 'pending', 'idle', 'error']);

describe('describeBuildStatus', () => {
  it('maps every install status to a status i18n key and a known tone', () => {
    for (const status of Object.values(InstallStatuses)) {
      const view = describeBuildStatus(status);
      expect(view.labelKey.startsWith('clients.status.')).toBe(true);
      expect(TONES.has(view.tone)).toBe(true);
    }
  });

  it('maps installed → ready and error → error', () => {
    expect(describeBuildStatus(InstallStatuses.INSTALLED)).toEqual({
      labelKey: 'clients.status.ready',
      tone: 'ready',
    });
    expect(describeBuildStatus(InstallStatuses.ERROR)).toEqual({
      labelKey: 'clients.status.error',
      tone: 'error',
    });
  });
});
