import {
  type ConsoleInitialPayload,
  type ConsoleLine,
  type ConsoleProcessState,
  ConsoleStatuses,
} from '@shared/contracts/console';
import type { CatalogKey } from '@shared/contracts/ids';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clear as clearConsole, getInitial, onBufferReset, onLines, onState } from '../api';

const INITIAL_STATE: ConsoleProcessState = {
  key: '' as CatalogKey,
  status: ConsoleStatuses.IDLE,
};
const RECONCILE_INTERVAL_MS = 1000;

export type ConsoleStreamApi = {
  state: ConsoleProcessState;
  clientTitle: string;
  lines: ConsoleLine[];
  droppedCount: number;
  paused: boolean;
  togglePause: () => void;
  clear: () => void;
};

// Single slice (O(limit) memcpy) instead of Array.splice to avoid per-element
// shifts on large buffers.
const trimToWindow = <T>(items: T[], limit: number): { items: T[]; dropped: number } => {
  if (items.length <= limit) return { items, dropped: 0 };
  const dropped = items.length - limit;
  return { items: items.slice(dropped), dropped };
};

export const useConsoleStream = (
  bufferLimit: number,
  onResetSelection: () => void,
): ConsoleStreamApi => {
  const [state, setState] = useState<ConsoleProcessState>(INITIAL_STATE);
  const [clientTitle, setClientTitle] = useState<string>('');
  const [lines, setLines] = useState<ConsoleLine[]>([]);
  const [droppedCount, setDroppedCount] = useState(0);
  const [paused, setPaused] = useState(false);

  const seenIdsRef = useRef<Set<number>>(new Set());
  const pendingRef = useRef<ConsoleLine[]>([]);
  const flushGuardRef = useRef<number | null>(null);

  // Mirror so the IPC listener can read latest paused without resubscribing on
  // toggle; a strict-mode cleanup/resubscribe gap would otherwise drop pushes.
  const pausedRef = useRef(paused);
  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  const appendPending = useCallback(
    (incoming: readonly ConsoleLine[]) => {
      pendingRef.current.push(...incoming);
      const trimmed = trimToWindow(pendingRef.current, bufferLimit);
      pendingRef.current = trimmed.items;
    },
    [bufferLimit],
  );

  const refreshInitial = useCallback(() => {
    let cancelled = false;
    getInitial()
      .then((payload: ConsoleInitialPayload) => {
        if (cancelled) return;
        if (payload.activeSession) {
          setClientTitle(payload.activeSession.clientTitle);
          setState(payload.activeSession.state);
        } else {
          setClientTitle('');
          setState(INITIAL_STATE);
        }
        setDroppedCount(payload.droppedCount);
        const seen = new Set<number>();
        for (const line of payload.lines) seen.add(line.id);
        seenIdsRef.current = seen;
        setLines(payload.lines);
      })
      .catch(() => {
        // main may not be ready on mount; the reconcile poll catches up.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refreshInitial(), [refreshInitial]);

  const flushPending = useCallback(() => {
    const incoming = pendingRef.current;
    if (incoming.length === 0) return;
    pendingRef.current = [];
    setLines((prev) => {
      const seen = seenIdsRef.current;
      const merged = prev.slice();
      for (const line of incoming) {
        if (seen.has(line.id)) continue;
        seen.add(line.id);
        merged.push(line);
      }
      const trimmed = trimToWindow(merged, bufferLimit);
      if (trimmed.dropped > 0) {
        for (let i = 0; i < trimmed.dropped; i++) {
          const dropped = merged[i];
          if (dropped) seen.delete(dropped.id);
        }
        setDroppedCount((current) => current + trimmed.dropped);
      }
      return trimmed.items;
    });
  }, [bufferLimit]);

  const scheduleFlush = useCallback(() => {
    if (flushGuardRef.current != null) return;
    // queueMicrotask instead of RAF: RAF is paused for occluded BrowserWindows
    // even with backgroundThrottling: false; microtasks always run.
    flushGuardRef.current = 1;
    queueMicrotask(() => {
      flushGuardRef.current = null;
      flushPending();
    });
  }, [flushPending]);

  useEffect(() => {
    const offLines = onLines((incoming) => {
      appendPending(incoming);
      if (pausedRef.current) return;
      scheduleFlush();
    });
    const offState = onState((event) => {
      setState(event);
      if (event.clientTitle !== undefined) setClientTitle(event.clientTitle);
    });
    const offReset = onBufferReset(() => {
      pendingRef.current = [];
      seenIdsRef.current = new Set();
      onResetSelection();
      refreshInitial();
    });
    return () => {
      offLines();
      offState();
      offReset();
      // Microtasks can't be cancelled — clear the guard so a late callback
      // becomes a no-op (reads empty pending).
      flushGuardRef.current = null;
    };
  }, [scheduleFlush, refreshInitial, onResetSelection, appendPending]);

  useEffect(() => {
    if (!paused && pendingRef.current.length > 0) scheduleFlush();
  }, [paused, scheduleFlush]);

  const isLive =
    state.status === ConsoleStatuses.LAUNCHING || state.status === ConsoleStatuses.RUNNING;

  // Reconciliation poll: Chromium can throttle occluded windows; catch any
  // pushes the live channel missed. seenIdsRef dedupes live arrivals.
  useEffect(() => {
    if (!isLive) return;
    const handle = window.setInterval(() => {
      getInitial()
        .then((payload: ConsoleInitialPayload) => {
          const session = payload.activeSession;
          if (session) {
            setClientTitle(session.clientTitle);
            setState((prev) =>
              prev.status === session.state.status && prev.exitCode === session.state.exitCode
                ? prev
                : session.state,
            );
          }
          setDroppedCount(payload.droppedCount);
          const seen = seenIdsRef.current;
          const fresh = payload.lines.filter((line) => !seen.has(line.id));
          if (fresh.length === 0) return;
          appendPending(fresh);
          if (pausedRef.current) return;
          scheduleFlush();
        })
        .catch(() => {
          // Background poll: a transient IPC failure is retried next tick.
        });
    }, RECONCILE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [isLive, scheduleFlush, appendPending]);

  const togglePause = useCallback(() => setPaused((value) => !value), []);

  const clear = useCallback(() => {
    void clearConsole().catch(() => {
      // Local buffer is wiped below regardless; the reconcile poll reseeds the
      // main-side mirror if this IPC failed.
    });
    pendingRef.current = [];
    seenIdsRef.current = new Set();
    setLines([]);
    setDroppedCount(0);
    onResetSelection();
  }, [onResetSelection]);

  return { state, clientTitle, lines, droppedCount, paused, togglePause, clear };
};
