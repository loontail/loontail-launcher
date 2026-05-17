import { create } from 'zustand';

export const Views = {
  HOME: 'home',
  SETTINGS: 'settings',
} as const;

export type View = (typeof Views)[keyof typeof Views];

type NavigationState = {
  stack: View[];
  push: (view: View) => void;
  pop: () => void;
};

export const useNavigationStore = create<NavigationState>((set) => ({
  stack: [Views.HOME],
  push: (view) =>
    set((state) => ({
      stack: state.stack[state.stack.length - 1] === view ? state.stack : [...state.stack, view],
    })),
  pop: () =>
    set((state) => ({
      stack: state.stack.length > 1 ? state.stack.slice(0, -1) : state.stack,
    })),
}));

export const useCurrentView = (): View =>
  useNavigationStore((state) => state.stack[state.stack.length - 1] ?? Views.HOME);

export const useCanGoBack = (): boolean => useNavigationStore((state) => state.stack.length > 1);
