import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';
import { Image, ImageOff, Info, Server as ServerIcon, SlidersHorizontal } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildAbout } from './BuildAbout';
import { BuildGallery } from './BuildGallery';
import { BuildHero } from './BuildHero';
import { BuildMedia, buildScreenshotCount } from './BuildMedia';
import { BuildSettingsTab } from './BuildSettingsTab';
import { PlayButton } from './PlayButton';
import { ServersInfo } from './ServersInfo';

type BuildDetailPageProps = {
  item: CatalogItem;
  onBack: () => void;
};

const TABS = ['about', 'media', 'servers', 'settings'] as const;
type TabId = (typeof TABS)[number];

const TAB_ICONS: Record<TabId, typeof Info> = {
  about: Info,
  media: Image,
  servers: ServerIcon,
  settings: SlidersHorizontal,
};

const EmptyState = ({ icon: Icon, label }: { icon: typeof Info; label: string }) => (
  <div className="flex flex-col items-center justify-center gap-3 rounded-md border border-edge bg-surface-1/40 px-6 py-14 text-center">
    <Icon className="size-7 text-text-faint" strokeWidth={1.5} />
    <p className="text-caption text-text-mute">{label}</p>
  </div>
);

export const BuildDetailPage = ({ item, onBack }: BuildDetailPageProps) => {
  const { t } = useTranslation();
  const [active, setActive] = useState<TabId>('about');
  const [collapsed, setCollapsed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Record<TabId, HTMLButtonElement | null>>({
    about: null,
    media: null,
    servers: null,
    settings: null,
  });
  const baseId = useId();

  // The compact sticky header appears once the hero's launch row scrolls past the
  // top — observe a sentinel placed just below the hero rather than wiring a raw
  // scroll handler, so it stays cheap and jank-free in the 624px window.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root) return;
    const observer = new IntersectionObserver(([entry]) => setCollapsed(!entry?.isIntersecting), {
      root,
      threshold: 0,
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const hasMedia = buildScreenshotCount(item) > 0;
  const hasServers = item.presentation.servers.length > 0;
  const hasAbout = Boolean(item.presentation.description);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.indexOf(active);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    event.preventDefault();
    const nextTab = TABS[next];
    if (!nextTab) return;
    setActive(nextTab);
    tabRefs.current[nextTab]?.focus();
  };

  const panel = (id: TabId, content: ReactNode): ReactNode => (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${id}`}
      aria-labelledby={`${baseId}-tab-${id}`}
      hidden={active !== id}
    >
      {active === id && content}
    </div>
  );

  return (
    <div ref={scrollRef} className="relative h-full overflow-y-auto overflow-x-hidden">
      {/* Fixed full-bleed backdrop — this build's key art, held still under the
          scrolling body with layered scrims keeping text legible. */}
      <div
        className="pointer-events-none fixed bottom-0 left-15 right-0 top-10 z-0"
        aria-hidden="true"
      >
        <BuildMedia
          item={item}
          slot="background"
          fallback="visual"
          className="h-full w-full object-cover brightness-[0.55]"
        />
        <div className="absolute inset-0 bg-linear-to-r from-overlay/85 via-overlay/55 to-overlay/15" />
        <div className="absolute inset-0 bg-linear-to-t from-overlay/90 via-overlay/30 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-32 bg-linear-to-b from-overlay/70 to-transparent" />
      </div>

      {/* Compact sticky header: title + Play pinned at the top once the hero
          scrolls away, so launch stays one click out at any scroll depth. */}
      <div
        className={cn(
          'glass-panel sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-edge px-6 py-2.5 transition-all duration-200 ease-standard motion-safe:transition-all',
          collapsed
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-full opacity-0',
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-h2 font-bold text-text-hi">
          {item.presentation.title}
        </h2>
        <div className="shrink-0">
          <PlayButton item={item} />
        </div>
      </div>

      <div className="relative z-10">
        <BuildHero item={item} onBack={onBack} />
        <div ref={sentinelRef} aria-hidden="true" className="h-px w-full" />

        <div className="px-12 pb-16">
          <div
            role="tablist"
            aria-label={t('clients.detailAria', { name: item.presentation.title })}
            className="glass mb-8 flex w-fit gap-1 rounded-full border border-edge p-1"
          >
            {TABS.map((id) => {
              const Icon = TAB_ICONS[id];
              const isActive = active === id;
              return (
                <button
                  key={id}
                  ref={(el) => {
                    tabRefs.current[id] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`${baseId}-tab-${id}`}
                  aria-selected={isActive}
                  aria-controls={`${baseId}-panel-${id}`}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActive(id)}
                  onKeyDown={onTabKeyDown}
                  className={cn(
                    'flex items-center gap-2 rounded-full px-4 py-1.5 text-caption font-semibold transition-colors duration-150 ease-standard',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50',
                    isActive
                      ? 'bg-cta text-on-cta'
                      : 'text-text-mute hover:bg-ghost-hover hover:text-text',
                  )}
                >
                  <Icon className="size-3.5" strokeWidth={2} />
                  {t(`clients.tabs.${id}`)}
                </button>
              );
            })}
          </div>

          <div className="max-w-180">
            {panel(
              'about',
              hasAbout ? (
                <BuildAbout item={item} />
              ) : (
                <EmptyState icon={Info} label={t('clients.noAbout')} />
              ),
            )}
            {panel(
              'media',
              hasMedia ? (
                <BuildGallery item={item} />
              ) : (
                <EmptyState icon={ImageOff} label={t('clients.noMedia')} />
              ),
            )}
            {panel(
              'servers',
              hasServers ? (
                <ServersInfo servers={item.presentation.servers} />
              ) : (
                <EmptyState icon={ServerIcon} label={t('clients.noServers')} />
              ),
            )}
            {panel('settings', <BuildSettingsTab item={item} onBuildDeleted={onBack} />)}
          </div>
        </div>
      </div>
    </div>
  );
};
