import { createValueStore } from '@renderer/shared/lib/stores/createValueStore';
import type { UpdaterStatusEvent } from '@shared/ipc';

export const useUpdaterStore = createValueStore<UpdaterStatusEvent | null>(null);

export const useUpdaterStatus = (): UpdaterStatusEvent | null => useUpdaterStore.useValue();
