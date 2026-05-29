import { selectClientActionsState } from '@renderer/features/clients/components/client-settings/ClientActionsSection';
import { InstallStatuses } from '@shared/contracts/minecraft';
import { describe, expect, it } from 'vitest';

const select = (overrides: Partial<Parameters<typeof selectClientActionsState>[0]> = {}) =>
  selectClientActionsState({
    status: InstallStatuses.INSTALLED,
    repairPending: false,
    cancelPending: false,
    uninstallPending: false,
    ...overrides,
  });

describe('selectClientActionsState', () => {
  it('allows repair and uninstall for an idle installed client', () => {
    expect(select()).toEqual({
      repairActive: false,
      repairDisabled: false,
      uninstallDisabled: false,
    });
  });

  it('turns the repair action into cancel while repair is active', () => {
    expect(select({ status: InstallStatuses.REPAIRING })).toEqual({
      repairActive: true,
      repairDisabled: false,
      uninstallDisabled: true,
    });
  });

  it('does not re-enable the active repair action while cancel is pending', () => {
    expect(
      select({
        status: InstallStatuses.REPAIRING,
        cancelPending: true,
      }),
    ).toEqual({
      repairActive: true,
      repairDisabled: true,
      uninstallDisabled: true,
    });
  });
});
