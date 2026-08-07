import { Box, Boxes, Cpu, Gamepad2, type LucideIcon, Server, Shield } from 'lucide-react';

// Keys are persisted in the local build manifest (presentation.iconPreset); keep them stable.
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
