import { createValueStore } from '@renderer/shared/lib/stores/createValueStore';

export type BuildViewMode = 'grid' | 'list';

// Catalog grid/list preference. Module-level so the choice survives navigating
// away to a build and back without persisting to disk.
export const buildViewModeStore = createValueStore<BuildViewMode>('grid');
