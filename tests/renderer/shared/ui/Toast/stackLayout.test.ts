import { resolveToastStackLayout } from '@renderer/shared/ui/Toast/stackLayout';
import { describe, expect, it } from 'vitest';

type TestEntry = {
  id: number;
  closing: boolean;
  mounted: boolean;
};

const entry = (id: number, patch: Partial<TestEntry> = {}): TestEntry => ({
  id,
  closing: false,
  mounted: true,
  ...patch,
});

describe('resolveToastStackLayout', () => {
  it('returns null for an empty stack', () => {
    expect(resolveToastStackLayout([], {}, false)).toBeNull();
  });

  it('collapses newest-first toasts into a non-interactive preview stack', () => {
    const layout = resolveToastStackLayout(
      [entry(1), entry(2), entry(3), entry(4)],
      { 1: 100, 2: 110, 3: 120, 4: 130 },
      false,
    );

    expect(layout).toEqual({
      height: 146,
      items: [
        {
          entry: entry(4),
          paused: false,
          style: {
            transform: 'translate3d(0px, 0px, 0) scale(1)',
            transformOrigin: 'right bottom',
            opacity: 1,
            zIndex: 100,
            pointerEvents: undefined,
          },
        },
        {
          entry: entry(3),
          paused: false,
          style: {
            transform: 'translate3d(0px, -8px, 0) scale(0.95)',
            transformOrigin: 'right bottom',
            opacity: 0.75,
            zIndex: 99,
            pointerEvents: 'none',
          },
        },
        {
          entry: entry(2),
          paused: false,
          style: {
            transform: 'translate3d(0px, -16px, 0) scale(0.9)',
            transformOrigin: 'right bottom',
            opacity: 0.5,
            zIndex: 98,
            pointerEvents: 'none',
          },
        },
        {
          entry: entry(1),
          paused: false,
          style: {
            transform: 'translate3d(0px, -24px, 0) scale(0.85)',
            transformOrigin: 'right bottom',
            opacity: 0,
            zIndex: 97,
            pointerEvents: 'none',
          },
        },
      ],
    });
  });

  it('expands the stack with measured gaps and pauses all timers', () => {
    const layout = resolveToastStackLayout(
      [entry(1), entry(2), entry(3)],
      { 1: 100, 2: 110, 3: 120 },
      true,
    );

    expect(layout).toEqual({
      height: 350,
      items: [
        {
          entry: entry(3),
          paused: true,
          style: {
            transform: 'translate3d(0px, 0px, 0) scale(1)',
            transformOrigin: 'right bottom',
            opacity: 1,
            zIndex: 100,
            pointerEvents: undefined,
          },
        },
        {
          entry: entry(2),
          paused: true,
          style: {
            transform: 'translate3d(0px, -130px, 0) scale(1)',
            transformOrigin: 'right bottom',
            opacity: 1,
            zIndex: 99,
            pointerEvents: undefined,
          },
        },
        {
          entry: entry(1),
          paused: true,
          style: {
            transform: 'translate3d(0px, -250px, 0) scale(1)',
            transformOrigin: 'right bottom',
            opacity: 1,
            zIndex: 98,
            pointerEvents: undefined,
          },
        },
      ],
    });
  });

  it('keeps closing toasts paused and staged off-screen', () => {
    const layout = resolveToastStackLayout([entry(1, { closing: true })], { 1: 100 }, false);

    expect(layout?.items[0]).toEqual({
      entry: entry(1, { closing: true }),
      paused: true,
      style: {
        transform: 'translate3d(calc(100% + 1.5rem), 0px, 0) scale(1)',
        transformOrigin: 'right bottom',
        opacity: 0,
        zIndex: 100,
        pointerEvents: undefined,
      },
    });
  });
});
