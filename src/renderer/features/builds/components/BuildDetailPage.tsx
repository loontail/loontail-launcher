import { loaderVersionFor, primaryLoader } from '@renderer/features/catalog';
import { cn } from '@renderer/shared/lib/cn';
import { PAGE_CONTAINER } from '@renderer/shared/lib/layout';
import { Button } from '@renderer/shared/ui/Button';
import type { CatalogItem } from '@shared/contracts/catalog';
import { Gamepad2, type LucideIcon, Package, Settings } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildDetailHero } from './BuildDetailHero';
import { BuildGallery } from './BuildGallery';
import { buildScreenshotCount } from './BuildMedia';
import { BuildOverview } from './BuildOverview';
import { BuildSettingsModal } from './BuildSettingsModal';
import { PlayButton } from './PlayButton';
import { ServersInfo } from './ServersInfo';

type BuildDetailPageProps = {
  item: CatalogItem;
  onBack: () => void;
};

type TabId = 'overview' | 'screenshots' | 'servers';

const InfoChip = ({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) => (
  <div
    title={label}
    className="inline-flex h-11 items-center gap-2 rounded-md border border-edge bg-surface-1 px-3.5 text-body-med text-text-hi"
  >
    <Icon className="size-4 shrink-0 text-text-mute" strokeWidth={2} aria-hidden />
    <span className="tabular-nums">{value}</span>
  </div>
);

export const BuildDetailPage = ({ item, onBack }: BuildDetailPageProps) => {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const baseId = useId();

  const loader = primaryLoader(item);
  const loaderVersion = loaderVersionFor(item);
  const { minecraftVersion } = item.spec;
  const loaderLabel = `${t(`buildSettings.loader.${loader}`)}${loaderVersion ? ` ${loaderVersion}` : ''}`;

  const hasMedia = buildScreenshotCount(item) > 0;
  const hasServers = item.presentation.servers.length > 0;
  const tabs: TabId[] = [
    'overview',
    ...(hasMedia ? (['screenshots'] as const) : []),
    ...(hasServers ? (['servers'] as const) : []),
  ];
  const [active, setActive] = useState<TabId>('overview');

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(active);
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next === null) return;
    event.preventDefault();
    const nextTab = tabs[next];
    if (!nextTab) return;
    setActive(nextTab);
    document.getElementById(`${baseId}-tab-${nextTab}`)?.focus();
  };

  const panel = (id: TabId, content: ReactNode): ReactNode =>
    active === id ? (
      <div role="tabpanel" id={`${baseId}-panel-${id}`} aria-labelledby={`${baseId}-tab-${id}`}>
        {content}
      </div>
    ) : null;

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden">
      <BuildDetailHero item={item} />

      <div className={cn(PAGE_CONTAINER, 'pb-16')}>
        <div className="flex flex-wrap items-center gap-3 py-6">
          <PlayButton item={item} />
          <Button
            variant="secondary"
            size="icon"
            className="size-11"
            onClick={() => setSettingsOpen(true)}
            aria-label={t('builds.tabs.settings')}
          >
            <Settings className="size-4.5" strokeWidth={2} />
          </Button>
          <InfoChip icon={Gamepad2} label={t('builds.stat.version')} value={minecraftVersion} />
          <InfoChip icon={Package} label={t('builds.stat.loader')} value={loaderLabel} />
        </div>

        <div
          role="tablist"
          aria-label={t('builds.detailAria', { name: item.presentation.title })}
          className="flex gap-7 border-b border-edge"
        >
          {tabs.map((id) => {
            const isActive = active === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                id={`${baseId}-tab-${id}`}
                aria-selected={isActive}
                aria-controls={`${baseId}-panel-${id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => setActive(id)}
                onKeyDown={onTabKeyDown}
                className={cn(
                  'relative -mb-px cursor-pointer pb-3 text-body-med transition-colors duration-150 ease-standard',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  isActive ? 'text-text-hi' : 'text-text-mute hover:text-text',
                )}
              >
                {t(`builds.tabs.${id}`)}
                {isActive && (
                  <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-text-hi" />
                )}
              </button>
            );
          })}
        </div>

        {panel(
          'overview',
          <BuildOverview item={item} onViewScreenshots={() => setActive('screenshots')} />,
        )}
        {panel(
          'screenshots',
          <div className="pt-7">
            <BuildGallery item={item} />
          </div>,
        )}
        {panel(
          'servers',
          <div className="pt-7">
            <ServersInfo servers={item.presentation.servers} />
          </div>,
        )}
      </div>

      <BuildSettingsModal
        item={item}
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onBuildDeleted={() => {
          setSettingsOpen(false);
          onBack();
        }}
      />
    </div>
  );
};
