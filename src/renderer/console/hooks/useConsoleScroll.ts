import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const SCROLL_BOTTOM_THRESHOLD = 24;

export type ConsoleScrollApi = {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  scrollTop: number;
  viewportHeight: number;
  showJumpButton: boolean;
  jumpToBottom: () => void;
  scrollToRow: (index: number, rowHeight: number) => void;
};

export const useConsoleScroll = (linesCount: number): ConsoleScrollApi => {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const isAtBottomRef = useRef(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [showJumpButton, setShowJumpButton] = useState(false);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    const onScroll = () => {
      const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
      isAtBottomRef.current = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
      setShowJumpButton(!isAtBottomRef.current);
      setScrollTop(element.scrollTop);
    };
    const onResize = () => setViewportHeight(element.clientHeight);
    element.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    onResize();
    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: linesCount is the trigger; body reads only refs
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    if (isAtBottomRef.current) element.scrollTop = element.scrollHeight;
  }, [linesCount]);

  const jumpToBottom = useCallback(() => {
    const element = bodyRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    isAtBottomRef.current = true;
    setShowJumpButton(false);
  }, []);

  const scrollToRow = useCallback((index: number, rowHeight: number) => {
    const element = bodyRef.current;
    if (!element) return;
    const target = index * rowHeight;
    if (
      target < element.scrollTop ||
      target > element.scrollTop + element.clientHeight - rowHeight
    ) {
      element.scrollTop = Math.max(0, target - element.clientHeight / 2 + rowHeight / 2);
    }
  }, []);

  return { bodyRef, scrollTop, viewportHeight, showJumpButton, jumpToBottom, scrollToRow };
};
