import { buildInitial, fallbackHue } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';
import { BuildMedia } from './BuildMedia';

type BuildIconProps = {
  item: CatalogItem;
  className?: string;
};

// The build's icon: the `poster` media shown whole and centered (object-contain,
// never cropped or stretched), over a deterministic gradient + initial so a
// build with no icon (most local builds) or a failed image still reads.
export const BuildIcon = ({ item, className }: BuildIconProps) => {
  const hue = fallbackHue(item);
  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-2xl border border-edge-md',
        className,
      )}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 40% 26%), hsl(${(hue + 45) % 360} 36% 15%))`,
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 flex select-none items-center justify-center text-2xl font-bold text-glass/75"
      >
        {buildInitial(item)}
      </span>
      <BuildMedia
        item={item}
        slot="poster"
        fallback="none"
        className="relative max-h-[82%] max-w-[82%] object-contain"
      />
    </div>
  );
};
