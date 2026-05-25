import { MinecraftKit } from '@loontail/minecraft-kit';
import { kitLogger } from '@main/infra/logger';

// Single process-wide kit so install/launch/repair/skin/auth share the same
// in-memory metadata cache (version manifests, library indices, etc.).
// Construct once at bootstrap and pass through service factories — never import
// a module singleton, so tests can swap in a fake kit per service.
export const createKit = (): MinecraftKit => new MinecraftKit({ logger: kitLogger('kit') });
