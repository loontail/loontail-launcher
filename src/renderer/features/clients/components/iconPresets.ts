import { Box, Boxes, Cpu, Gamepad2, type LucideIcon, Server, Shield } from 'lucide-react';

// Built-in build icons offered in the Create-build dialog and rendered by
// BuildIcon. The key is persisted in the instance manifest
// (presentation.iconPreset), so keep these stable.
export const ICON_PRESETS = {
  blocks: Boxes,
  gamepad: Gamepad2,
  box: Box,
  cpu: Cpu,
  server: Server,
  shield: Shield,
} as const satisfies Record<string, LucideIcon>;

export type IconPresetKey = keyof typeof ICON_PRESETS;

export const ICON_PRESET_KEYS = Object.keys(ICON_PRESETS) as IconPresetKey[];

export const iconPresetFor = (key: string | null | undefined): LucideIcon | null =>
  key && key in ICON_PRESETS ? ICON_PRESETS[key as IconPresetKey] : null;
