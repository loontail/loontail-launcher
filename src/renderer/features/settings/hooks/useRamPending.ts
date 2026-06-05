import { useEffect, useState } from 'react';

type UseRamPendingArgs = {
  savedRam: number;
  // Identity that, when changed, discards any unsaved pending value (e.g. the
  // settings tab reopening or the active client switching).
  resetKey: unknown;
  persist: (ramMb: number) => Promise<unknown>;
};

type UseRamPending = {
  ramValue: number;
  setRam: (value: number) => void;
  handleSave: () => Promise<void>;
  isDirty: boolean;
  reset: () => void;
};

export const useRamPending = ({
  savedRam,
  resetKey,
  persist,
}: UseRamPendingArgs): UseRamPending => {
  const [pendingRam, setPendingRam] = useState<number | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is driven by resetKey, not savedRam
  useEffect(() => {
    setPendingRam(null);
  }, [resetKey]);

  const ramValue = pendingRam ?? savedRam;

  const handleSave = async (): Promise<void> => {
    if (pendingRam === null) return;
    await persist(pendingRam);
    setPendingRam(null);
  };

  return {
    ramValue,
    setRam: setPendingRam,
    handleSave,
    isDirty: pendingRam !== null && pendingRam !== savedRam,
    reset: () => setPendingRam(null),
  };
};
