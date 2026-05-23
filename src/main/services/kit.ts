import { MinecraftKit } from '@loontail/minecraft-kit';
import { kitLogger } from '@main/infra/logger';

// Single process-wide kit so install/launch/repair/skin/auth share the same
// in-memory metadata cache (version manifests, library indices, etc.).
export const kit = new MinecraftKit({ logger: kitLogger('kit') });
