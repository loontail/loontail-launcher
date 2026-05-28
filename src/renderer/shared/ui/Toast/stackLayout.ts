import type { CSSProperties } from 'react';

const STACK_PEEK_Y = 8;
const STACK_SCALE_STEP = 0.05;
const STACK_OPACITY_STEP = 0.25;
const STACK_VISIBLE = 3;
const GAP = 10;

type StackEntry = {
  id: number;
  closing: boolean;
  mounted: boolean;
};

export type ToastStackLayoutItem<TEntry extends StackEntry> = {
  entry: TEntry;
  paused: boolean;
  style: CSSProperties;
};

export type ToastStackLayout<TEntry extends StackEntry> = {
  height: number;
  items: ToastStackLayoutItem<TEntry>[];
};

const heightOf = (heights: Readonly<Record<number, number>>, id: number): number =>
  heights[id] ?? 0;

export const resolveToastStackLayout = <TEntry extends StackEntry>(
  entries: readonly TEntry[],
  heights: Readonly<Record<number, number>>,
  expanded: boolean,
): ToastStackLayout<TEntry> | null => {
  const ordered = [...entries].reverse();
  const front = ordered[0];
  if (!front) return null;

  const stackHeight =
    heightOf(heights, front.id) + Math.min(ordered.length - 1, STACK_VISIBLE - 1) * STACK_PEEK_Y;
  const expandedHeight = ordered.reduce(
    (sum, entry, index) => sum + heightOf(heights, entry.id) + (index > 0 ? GAP : 0),
    0,
  );

  const items = ordered.map((entry, index) => {
    const offsetWhenFanned = ordered
      .slice(0, index)
      .reduce((sum, previous) => sum + heightOf(heights, previous.id) + GAP, 0);

    let translateX: string;
    let translateY: number;
    let scale: number;
    let opacity: number;

    if (!entry.mounted || entry.closing) {
      translateX = 'calc(100% + 1.5rem)';
      translateY = expanded ? -offsetWhenFanned : -index * STACK_PEEK_Y;
      scale = expanded ? 1 : 1 - index * STACK_SCALE_STEP;
      opacity = 0;
    } else if (expanded) {
      translateX = '0px';
      translateY = -offsetWhenFanned;
      scale = 1;
      opacity = 1;
    } else {
      translateX = '0px';
      translateY = -index * STACK_PEEK_Y;
      scale = 1 - index * STACK_SCALE_STEP;
      opacity = index >= STACK_VISIBLE ? 0 : Math.max(0, 1 - index * STACK_OPACITY_STEP);
    }

    const pointerEvents: CSSProperties['pointerEvents'] =
      !expanded && index > 0 ? 'none' : undefined;

    return {
      entry,
      paused: expanded || entry.closing,
      style: {
        transform: `translate3d(${translateX}, ${translateY}px, 0) scale(${scale})`,
        transformOrigin: 'right bottom',
        opacity,
        zIndex: 100 - index,
        pointerEvents,
      },
    };
  });

  return {
    height: expanded ? expandedHeight : stackHeight,
    items,
  };
};
