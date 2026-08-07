import {
  type FocusEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';

type RovingGroupProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  // Bump (e.g. item count, view mode, search query) to re-evaluate descendants
  // after the focusable set changes.
  resetKey?: unknown;
};

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

// Roving-tabindex container: descendants are one tab stop with exactly one
// tabindex=0; arrow keys move focus by DOM order (wraps), Home/End jump to ends.
export const RovingGroup = ({ children, resetKey, ...rest }: RovingGroupProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const items = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  // Keep exactly one item tabbable: the existing tabindex=0, else the first.
  // biome-ignore lint/correctness/useExhaustiveDependencies: resetKey is the trigger; body reads only DOM
  useEffect(() => {
    const found = items();
    if (found.length === 0) return;
    const current = found.find((el) => el.getAttribute('tabindex') === '0');
    const active = current ?? found[0];
    for (const el of found) el.tabIndex = el === active ? 0 : -1;
  }, [items, resetKey]);

  const setActive = (next: HTMLElement, all: HTMLElement[]) => {
    for (const el of all) el.tabIndex = el === next ? 0 : -1;
    next.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    const all = items();
    if (all.length === 0) return;
    const index = all.indexOf(document.activeElement as HTMLElement);
    if (index < 0) return;

    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = all.length - 1;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = index + 1;
    else next = index - 1;

    const clamped = (next + all.length) % all.length;
    const target = all[clamped];
    if (!target) return;
    event.preventDefault();
    setActive(target, all);
  };

  // Focusing a child makes it the tabbable anchor so a later Tab-out returns here.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const all = items();
    const target = all.find((el) => el === event.target);
    if (!target) return;
    for (const el of all) el.tabIndex = el === target ? 0 : -1;
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only delegate arrow keys to the already-focusable children, which carry the interactive roles
    <div ref={ref} onKeyDown={onKeyDown} onFocus={onFocus} {...rest}>
      {children}
    </div>
  );
};
