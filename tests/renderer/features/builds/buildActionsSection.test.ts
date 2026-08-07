import { selectBuildActionsState } from '@renderer/features/builds/components/build-settings/BuildActionsSection';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const select = (overrides: Partial<Parameters<typeof selectBuildActionsState>[0]> = {}) =>
  selectBuildActionsState({
    status: InstallStatuses.INSTALLED,
    repairPending: false,
    uninstallPending: false,
    ...overrides,
  });

describe('selectBuildActionsState', () => {
  it('allows repair and uninstall for an idle installed client', () => {
    expect(select()).toEqual({
      repairActive: false,
      repairDisabled: false,
      uninstallDisabled: false,
    });
  });

  it('disables both actions while repair is active (no cancel affordance)', () => {
    expect(select({ status: InstallStatuses.REPAIRING })).toEqual({
      repairActive: true,
      repairDisabled: true,
      uninstallDisabled: true,
    });
  });

  it('disables repair while a repair request is pending', () => {
    expect(select({ repairPending: true })).toEqual({
      repairActive: false,
      repairDisabled: true,
      uninstallDisabled: false,
    });
  });
});
