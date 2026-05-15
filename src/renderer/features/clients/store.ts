import type { ClientId } from '@shared/contracts';
import { create } from 'zustand';

type ClientsState = {
  activeClientId: ClientId | null;
  setActiveClientId: (id: ClientId | null) => void;
};

export const useClientsStore = create<ClientsState>((set) => ({
  activeClientId: null,
  setActiveClientId: (id) => set({ activeClientId: id }),
}));

export const useActiveClientId = () => useClientsStore((state) => state.activeClientId);
