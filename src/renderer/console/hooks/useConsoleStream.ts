import {
  type ConsoleInitialPayload,
  type ConsoleLine,
  type ConsoleProcessState,
  ConsoleStatuses,
} from '@shared/contracts/console';
import type { ClientSlug } from '@shared/contracts/ids';
import { IPC_CHANNELS, IPC_EVENTS } from '@shared/ipc';
import { useCallback, useEffect, useRef, useState } from 'react';

const INITIAL_STATE: ConsoleProcessState = {
  slug: '' as ClientSlug,
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

// Keep the most recent `limit` items, returning the trimmed array and how many
// were dropped from the head. Single allocation via slice — O(limit) memcpy,
// no per-element shifts unlike Array.splice on large buffers.
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
    window.api
      .invoke(IPC_CHANNELS.consoleGetInitial, undefined)
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
        /* main may not be ready yet — live updates will catch us up */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => refreshInitial(), [refreshInitial]);

  // Coalesce inbound push batches so a burst of stdout becomes one setLines.
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
    const offLines = window.api.on(IPC_EVENTS.consoleLines, (incoming) => {
      appendPending(incoming);
      if (pausedRef.current) return;
      scheduleFlush();
    });
    const offState = window.api.on(IPC_EVENTS.consoleState, (event) => {
      setState(event);
      if (event.clientTitle !== undefined) setClientTitle(event.clientTitle);
    });
    const offReset = window.api.on(IPC_EVENTS.consoleBufferReset, () => {
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

  // Reconciliation poll: Chromium can throttle occluded windows; catch any
  // pushes the live channel missed. seenIdsRef dedupes live arrivals.
  useEffect(() => {
    const handle = window.setInterval(() => {
      window.api
        .invoke(IPC_CHANNELS.consoleGetInitial, undefined)
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
        .catch(() => {});
    }, RECONCILE_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [scheduleFlush, appendPending]);

  const togglePause = useCallback(() => setPaused((value) => !value), []);

  const clear = useCallback(() => {
    void window.api.invoke(IPC_CHANNELS.consoleClear, undefined).catch(() => {});
    pendingRef.current = [];
    seenIdsRef.current = new Set();
    setLines([]);
    setDroppedCount(0);
    onResetSelection();
  }, [onResetSelection]);

  return { state, clientTitle, lines, droppedCount, paused, togglePause, clear };
};
