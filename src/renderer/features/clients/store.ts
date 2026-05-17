import { createValueStore } from '@renderer/shared/lib/stores/createValueStore';
import type { ClientId } from '@shared/contracts';

export const useClientsStore = createValueStore<ClientId | null>(null);

export const useActiveClientId = (): ClientId | null => useClientsStore.useValue();
export const useSetActiveClientId = (): ((id: ClientId | null) => void) =>
  useClientsStore.useSetValue();
