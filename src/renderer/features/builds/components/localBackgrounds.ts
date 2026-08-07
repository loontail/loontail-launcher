import bg1 from '@renderer/assets/backgrounds/1.webp';
import bg2 from '@renderer/assets/backgrounds/2.webp';
import bg3 from '@renderer/assets/backgrounds/3.webp';
import bg4 from '@renderer/assets/backgrounds/4.webp';
import bg5 from '@renderer/assets/backgrounds/5.webp';
import bg6 from '@renderer/assets/backgrounds/6.webp';

// Seeded by the build's catalog key so a given build keeps a stable backdrop across renders.
const LOCAL_BACKGROUNDS = [bg1, bg2, bg3, bg4, bg5, bg6] as const;

export const localBackgroundFor = (key: string): string => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 1_000_003;
  }
  return LOCAL_BACKGROUNDS[hash % LOCAL_BACKGROUNDS.length] as string;
};
