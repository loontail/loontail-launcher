import { loaderVersionFor, primaryLoader } from '@renderer/features/catalog';
import { type CatalogItem, isOfficial } from '@shared/contracts/catalog';
import { Settings2 } from 'lucide-react';
import { Suspense, lazy, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BuildChip } from './BuildChip';
import { BuildMedia } from './BuildMedia';
import { BuildSection } from './BuildSection';
import { PlayButton } from './PlayButton';
import { ServersInfo } from './ServersInfo';

const ClientSettingsModal = lazy(() =>
  import('./ClientSettingsModal').then((module) => ({ default: module.ClientSettingsModal })),
);

type BuildHeroProps = {
  item: CatalogItem;
  // Closes the parent detail modal (used after a local build is deleted).
  onDeleted: () => void;
};

// The detail modal's main content column: title/logo, compact metadata chips, a
// short description, the launch row (play + settings) and the available servers —
// laid over the modal's fixed full-bleed backdrop. Mirrors the launcher's
// established client overview, just hosted inside a modal.
export const BuildHero = ({ item, onDeleted }: BuildHeroProps) => {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const hasTitleImage = isOfficial(item) && Boolean(item.raw.titleImage);
  const loader = primaryLoader(item);
  const loaderVersion = loaderVersionFor(item);
  const { minecraftVersion } = item.spec;
  const { title, shortDescription, servers } = item.presentation;
  const keywords = isOfficial(item) ? item.raw.keywords : [];
  const hasMeta = Boolean(minecraftVersion) || keywords.length > 0;

  return (
    <section className="flex flex-col gap-6 px-12 pb-12 pt-16">
      <div className="flex max-w-140 flex-col gap-5">
        {hasTitleImage ? (
          <div className="flex h-22 max-w-102.5 items-start">
            <BuildMedia
              item={item}
              slot="titleImage"
              fallback="none"
              className="h-full w-auto object-contain object-left drop-shadow-[0_8px_24px_var(--color-glow-overlay-lg)]"
            />
          </div>
        ) : (
          <h1 className="text-5xl font-black leading-[1.05] tracking-tight drop-shadow-[0_4px_16px_var(--color-glow-overlay-md)]">
            {title}
          </h1>
        )}

        {hasMeta && (
          <div className="flex flex-wrap gap-1.5">
            {minecraftVersion && (
              <BuildChip variant="version">
                {t('clients.versionChip.full', { version: minecraftVersion })}
              </BuildChip>
            )}
            {isOfficial(item) ? (
              keywords.map((keyword) => (
                <BuildChip key={keyword.id} variant="keyword">
                  {keyword.title}
                </BuildChip>
              ))
            ) : (
              <BuildChip variant="loader">
                {t(`clientSettings.loader.${loader}`)}
                {loaderVersion ? ` ${loaderVersion}` : ''}
              </BuildChip>
            )}
          </div>
        )}

        {shortDescription && (
          <p className="max-w-115 text-sm leading-relaxed text-glass/75 drop-shadow">
            {shortDescription}
          </p>
        )}
      </div>

      {/* Launch row sits outside the 560-wide column so the install progress
          stepper renders at its natural width. */}
      <div className="flex max-w-180 flex-wrap items-start gap-3">
        <PlayButton item={item} />
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t('clientSettings.openAria')}
          className="group flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-linear-to-b from-glass/15 to-glass/5 text-glass/75 ring-1 ring-edge-md backdrop-blur-md transition-all duration-150 hover:from-glass/20 hover:to-glass/10 hover:text-glass hover:ring-edge-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50"
          style={{
            boxShadow:
              'inset 0 1px 0 var(--shadow-inset-highlight), 0 6px 18px -8px var(--color-glow-overlay-md)',
          }}
        >
          <Settings2
            size={16}
            className="transition-transform duration-200 group-hover:rotate-45"
          />
        </button>
      </div>

      {servers.length > 0 && (
        <div className="max-w-130">
          <BuildSection title={t('clients.servers')}>
            <ServersInfo servers={servers} />
          </BuildSection>
        </div>
      )}

      {settingsOpen && (
        <Suspense fallback={null}>
          <ClientSettingsModal
            isOpen={settingsOpen}
            item={item}
            onClose={() => setSettingsOpen(false)}
            onBuildDeleted={onDeleted}
          />
        </Suspense>
      )}
    </section>
  );
};
