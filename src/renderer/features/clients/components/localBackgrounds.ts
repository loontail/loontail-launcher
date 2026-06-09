import bg1 from '@renderer/assets/backgrounds/1.png';
import bg2 from '@renderer/assets/backgrounds/2.png';
import bg3 from '@renderer/assets/backgrounds/3.png';
import bg4 from '@renderer/assets/backgrounds/4.png';
import bg5 from '@renderer/assets/backgrounds/5.png';
import bg6 from '@renderer/assets/backgrounds/6.png';

// Bundled Minecraft screenshots used as backdrops for personal builds that ship
// no key-art of their own. The pick is seeded by the build's catalog key so a
// given build keeps a stable backdrop across renders (never flickers).
const LOCAL_BACKGROUNDS = [bg1, bg2, bg3, bg4, bg5, bg6] as const;

export const localBackgroundFor = (key: string): string => {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % 1_000_003;
  }
  return LOCAL_BACKGROUNDS[hash % LOCAL_BACKGROUNDS.length] as string;
};
