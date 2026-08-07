import { create, type StoreApi, type UseBoundStore } from 'zustand';

type ValueStore<T> = {
  value: T;
  setValue: (value: T) => void;
};

export type ValueStoreHook<T> = UseBoundStore<StoreApi<ValueStore<T>>> & {
  useValue: () => T;
  useSetValue: () => (value: T) => void;
};

export const createValueStore = <T>(initial: T): ValueStoreHook<T> => {
  const hook = create<ValueStore<T>>((set) => ({
    value: initial,
    setValue: (value) => set({ value }),
  })) as ValueStoreHook<T>;
  hook.useValue = () => hook((state) => state.value);
  hook.useSetValue = () => hook((state) => state.setValue);
  return hook;
};
