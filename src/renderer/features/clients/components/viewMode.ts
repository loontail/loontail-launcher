import { createValueStore } from '@renderer/shared/lib/stores/createValueStore';

export type BuildViewMode = 'grid' | 'list';

// Module-level so the choice survives navigation without persisting to disk.
export const buildViewModeStore = createValueStore<BuildViewMode>('grid');
