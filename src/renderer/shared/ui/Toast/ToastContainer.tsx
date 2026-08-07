import { useCallback, useEffect, useRef, useState } from 'react';
import { resolveToastStackLayout } from './stackLayout';
import { type ToastEntry, ToastItem } from './ToastItem';
import { subscribeToToasts } from './toast';

const EXIT_ANIM_MS = 260;

export const ToastContainer = () => {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const [hovered, setHovered] = useState(false);
  const [heights, setHeights] = useState<Record<number, number>>({});
  const idRef = useRef(0);

  useEffect(
    () =>
      subscribeToToasts((payload) => {
        idRef.current += 1;
        const id = idRef.current;
        setEntries((prev) => [...prev, { ...payload, id, closing: false, mounted: false }]);
        // Two RAFs: paint off-screen first, then flip `mounted` so the enter
        // transition runs to the rest pose.
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setEntries((prev) =>
              prev.map((entry) => (entry.id === id ? { ...entry, mounted: true } : entry)),
            );
          });
        });
      }),
    [],
  );

  const dismiss = useCallback((id: number) => {
    setEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry)),
    );
    window.setTimeout(() => {
      setEntries((prev) => prev.filter((entry) => entry.id !== id));
      setHeights((prev) => {
        if (!(id in prev)) return prev;
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }, EXIT_ANIM_MS);
  }, []);

  const setHeight = useCallback((id: number, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  const layout = resolveToastStackLayout(entries, heights, hovered);
  if (!layout) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover only pauses auto-dismiss; every toast stays reachable and dismissable without it
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ height: layout.height }}
      className="pointer-events-none fixed right-4 bottom-4 z-[60] w-90 max-w-[92vw] transition-[height] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
    >
      {layout.items.map(({ entry, paused, style }) => (
        <ToastItem
          key={entry.id}
          entry={entry}
          paused={paused}
          onClose={() => dismiss(entry.id)}
          onHeight={setHeight}
          style={style}
        />
      ))}
    </div>
  );
};
