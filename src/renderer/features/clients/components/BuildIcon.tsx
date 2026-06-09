import { buildInitial, fallbackHue } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { type CatalogItem, isOfficial } from '@shared/contracts/catalog';
import type { ReactNode } from 'react';
import { BuildMedia } from './BuildMedia';
import { iconPresetFor } from './iconPresets';

type BuildIconProps = {
  item: CatalogItem;
  className?: string;
};

const hasPoster = (item: CatalogItem): boolean =>
  isOfficial(item) ? Boolean(item.raw.poster) : Boolean(item.presentation.media.poster);

// The build's icon: the `poster` media shown whole and centered (object-contain,
// never cropped or stretched) over a deterministic gradient. When there is no
// poster, a single initial stands in — rendered ONLY then, so a logo with
// transparency never shows the initial bleeding through behind it.
export const BuildIcon = ({ item, className }: BuildIconProps) => {
  const hue = fallbackHue(item);
  const Preset = iconPresetFor(item.presentation.iconPreset);

  let glyph: ReactNode;
  if (hasPoster(item)) {
    glyph = (
      <BuildMedia
        item={item}
        slot="poster"
        fallback="none"
        className="relative max-h-[82%] max-w-[82%] object-contain"
      />
    );
  } else if (Preset) {
    glyph = <Preset className="size-[46%] text-text-hi" strokeWidth={1.75} aria-hidden />;
  } else {
    glyph = (
      <span aria-hidden="true" className="select-none text-2xl font-bold text-text-mute">
        {buildInitial(item)}
      </span>
    );
  }

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-md border border-edge-md',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 45) % 360} 36% 15%))`,
      }}
    >
      {glyph}
    </div>
  );
};
