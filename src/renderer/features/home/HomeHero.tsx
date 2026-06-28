import { primaryLoader } from '@renderer/features/catalog';
import { BuildMedia, PlayButton } from '@renderer/features/clients';
import { cn } from '@renderer/shared/lib/cn';
import { PAGE_CONTAINER } from '@renderer/shared/lib/layout';
import { Button } from '@renderer/shared/ui/Button';
import type { CatalogItem } from '@shared/contracts/catalog';
import { Boxes, Gamepad2, Package, Settings } from 'lucide-react';
import { useTranslation } from 'react-i18next';

type HomeHeroProps = {
  item: CatalogItem;
  onOpenSettings: () => void;
  onOpenDetails: () => void;
};

export const HomeHero = ({ item, onOpenSettings, onOpenDetails }: HomeHeroProps) => {
  const { t } = useTranslation();
  const loader = primaryLoader(item);
  const { minecraftVersion } = item.spec;
  const { title } = item.presentation;

  return (
    <div className="absolute inset-0">
      <BuildMedia
        item={item}
        slot="background"
        fallback="visual"
        className="absolute inset-0 size-full object-cover"
      />
      <div className="absolute inset-0 bg-linear-to-r from-canvas via-canvas/70 to-canvas/30" />
      <div className="absolute inset-0 bg-linear-to-t from-canvas via-canvas/20 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-overlay/45 to-transparent" />

      <div
        className={cn(PAGE_CONTAINER, 'relative flex h-full flex-col justify-center pb-48 pt-14')}
      >
        <div className="flex max-w-2xl flex-col gap-4">
          <span className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
            {t('home.continuePlaying')}
          </span>

          <h1 className="text-6xl font-black leading-[0.95] tracking-tight text-text-hi drop-shadow-[0_4px_24px_var(--color-glow-overlay-lg)]">
            {title}
          </h1>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-body-med text-text">
            {minecraftVersion && (
              <span className="inline-flex items-center gap-1.5">
                <Gamepad2 className="size-4 text-text" strokeWidth={2} />
                <span className="tabular-nums">
                  {t('clients.versionChip.full', { version: minecraftVersion })}
                </span>
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <Package className="size-4 text-text" strokeWidth={2} />
              {t(`clientSettings.loader.${loader}`)}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <PlayButton item={item} />
            <Button
              variant="secondary"
              size="icon"
              className="size-11"
              onClick={onOpenSettings}
              aria-label={t('clients.tabs.settings')}
            >
              <Settings className="size-4.5" strokeWidth={2} />
            </Button>
            <Button variant="secondary" size="lg" onClick={onOpenDetails}>
              <Boxes className="size-4" strokeWidth={2} />
              {t('clients.details')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
