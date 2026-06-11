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

// Roving-tabindex container: treats its focusable button descendants as a single
// tab stop. Exactly one descendant carries tabindex=0 (the first, or whichever
// was last focused); the rest are tabindex=-1. Arrow keys move focus by DOM order
// (1-D, which wraps cleanly for a reflowing grid); Home/End jump to first/last.
// Activation is left to the children — they are real <button>s, so Enter/Space
// and click already work.
export const RovingGroup = ({ children, resetKey, ...rest }: RovingGroupProps) => {
  const ref = useRef<HTMLDivElement>(null);

  const items = useCallback((): HTMLElement[] => {
    const root = ref.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  // Keep exactly one item tabbable: the one that already has tabindex=0 if it
  // still exists, otherwise the first. Runs on mount and whenever resetKey moves.
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
    const index = all.findIndex((el) => el === document.activeElement);
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

  // Entering a child (click or programmatic focus) makes it the tabbable anchor
  // so a later Tab-out / Shift-Tab-in returns to where the user last was.
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const all = items();
    const target = all.find((el) => el === event.target);
    if (!target) return;
    for (const el of all) el.tabIndex = el === target ? 0 : -1;
  };

  return (
    <div ref={ref} onKeyDown={onKeyDown} onFocus={onFocus} {...rest}>
      {children}
    </div>
  );
};
