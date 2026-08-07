// One lifecycle vocabulary for every pausable/cancellable launcher operation
// (bundle syncs, Minecraft installs). Two independent booleans would represent
// four states for a three-state lifecycle — `paused && cancelled` being the one
// that must not exist.
export type LifecyclePhase = 'running' | 'paused' | 'cancelled';

export type Phased = { phase: LifecyclePhase };

// Cancel overrides pause: a paused operation can still be cancelled, but a
// cancelled one is terminal and never reverts.
export const markPaused = (target: Phased): void => {
  if (target.phase === 'running') target.phase = 'paused';
};

export const markCancelled = (target: Phased): void => {
  target.phase = 'cancelled';
};

export const markRunning = (target: Phased): void => {
  if (target.phase === 'paused') target.phase = 'running';
};

// Read phase through these predicates, not inlined `target.phase === …`: the
// mark* helpers mutate it across awaits via an aliased reference, which TS
// control-flow narrowing can't track — a function boundary keeps each read
// independent.
export const isCancelled = (target: Phased): boolean => target.phase === 'cancelled';
export const isPaused = (target: Phased): boolean => target.phase === 'paused';
export const isRunning = (target: Phased): boolean => target.phase === 'running';
