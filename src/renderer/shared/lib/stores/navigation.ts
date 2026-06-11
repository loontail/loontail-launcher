import type { CatalogKey } from '@shared/contracts/ids';
import { create } from 'zustand';

export type Route =
  | { name: 'home' }
  | { name: 'builds' }
  | { name: 'build'; key: CatalogKey }
  | { name: 'settings' };

const sameRoute = (a: Route | undefined, b: Route): boolean =>
  a !== undefined &&
  a.name === b.name &&
  (a.name !== 'build' || b.name !== 'build' || a.key === b.key);

type NavState = {
  stack: Route[];
  push: (r: Route) => void;
  replace: (r: Route) => void;
  pop: () => void;
  reset: (r: Route) => void;
};

export const useNavigationStore = create<NavState>((set) => ({
  stack: [{ name: 'home' }],
  push: (r) =>
    set((s) => (sameRoute(s.stack[s.stack.length - 1], r) ? s : { stack: [...s.stack, r] })),
  replace: (r) => set((s) => ({ stack: [...s.stack.slice(0, -1), r] })),
  pop: () => set((s) => (s.stack.length > 1 ? { stack: s.stack.slice(0, -1) } : s)),
  reset: (r) => set({ stack: [r] }),
}));

export const useCurrentRoute = (): Route =>
  useNavigationStore((s) => s.stack[s.stack.length - 1] ?? { name: 'home' });

export const useCanGoBack = (): boolean => useNavigationStore((s) => s.stack.length > 1);
