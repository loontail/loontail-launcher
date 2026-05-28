import { useCallback, useEffect, useRef, useState } from 'react';

type PendingTexture = {
  objectUrl: string;
};

const revokeTexture = (pending: PendingTexture | null) => {
  if (pending !== null) {
    URL.revokeObjectURL(pending.objectUrl);
  }
};

export const usePendingTexture = () => {
  const [pending, setPending] = useState<PendingTexture | null>(null);
  const pendingRef = useRef<PendingTexture | null>(null);

  const setFile = useCallback((file: File) => {
    const nextPending = { objectUrl: URL.createObjectURL(file) };
    const previousPending = pendingRef.current;
    pendingRef.current = nextPending;
    setPending(nextPending);
    revokeTexture(previousPending);
  }, []);

  const clear = useCallback(() => {
    const previousPending = pendingRef.current;
    if (previousPending === null) {
      return;
    }

    pendingRef.current = null;
    setPending(null);
    revokeTexture(previousPending);
  }, []);

  const clearIfCurrent = useCallback((objectUrl: string) => {
    const previousPending = pendingRef.current;
    if (previousPending?.objectUrl !== objectUrl) {
      return;
    }

    pendingRef.current = null;
    setPending(null);
    revokeTexture(previousPending);
  }, []);

  useEffect(() => {
    return () => {
      const previousPending = pendingRef.current;
      pendingRef.current = null;
      revokeTexture(previousPending);
    };
  }, []);

  return {
    objectUrl: pending?.objectUrl ?? null,
    hasPending: pending !== null,
    setFile,
    clear,
    clearIfCurrent,
  } as const;
};
