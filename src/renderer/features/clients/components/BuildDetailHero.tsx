import { cn } from '@renderer/shared/lib/cn';
import { PAGE_CONTAINER } from '@renderer/shared/lib/layout';
import type { CatalogItem } from '@shared/contracts/catalog';
import { BuildIcon } from './BuildIcon';
import { BuildMedia } from './BuildMedia';

// The detail page's full-bleed key-art banner: the build's logo + title at the
// bottom-left. Install status and provenance are intentionally omitted here —
// the Play/Install button already conveys readiness, and the page context makes
// ownership obvious.
export const BuildDetailHero = ({ item }: { item: CatalogItem }) => {
  const { title } = item.presentation;

  return (
    <div className="relative h-60 w-full overflow-hidden">
      <BuildMedia
        item={item}
        slot="background"
        fallback="visual"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-linear-to-t from-canvas via-canvas/55 to-canvas/20" />
      <div className="absolute inset-0 bg-linear-to-r from-canvas/75 via-canvas/10 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-24 bg-linear-to-b from-overlay/45 to-transparent" />

      <div
        className={cn(PAGE_CONTAINER, 'absolute inset-x-0 bottom-0 flex items-center gap-4 pb-5')}
      >
        <BuildIcon
          item={item}
          className="size-16 shrink-0 rounded-lg border border-edge shadow-[0_8px_24px_var(--color-glow-overlay-lg)]"
        />
        <h1 className="min-w-0 truncate text-4xl font-extrabold text-text-hi drop-shadow-[0_2px_12px_var(--color-glow-overlay-lg)]">
          {title}
        </h1>
      </div>
    </div>
  );
};
