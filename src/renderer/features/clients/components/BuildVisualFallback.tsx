import { buildInitial, fallbackHue } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';

type BuildVisualFallbackProps = {
  item: CatalogItem;
  className?: string | undefined;
  showInitial?: boolean;
};

export const BuildVisualFallback = ({
  item,
  className,
  showInitial = true,
}: BuildVisualFallbackProps) => {
  const hue = fallbackHue(item);
  return (
    <div
      aria-hidden="true"
      className={cn('flex items-center justify-center', className)}
      style={{
        backgroundImage: `linear-gradient(135deg, hsl(${hue} 42% 20%), hsl(${(hue + 45) % 360} 38% 11%))`,
      }}
    >
      {showInitial && (
        <span className="select-none text-4xl font-black text-glass/25">{buildInitial(item)}</span>
      )}
    </div>
  );
};
