import { useClientStatus } from '@renderer/features/minecraft';
import type { Client } from '@shared/contracts/client';
import { type InstallStatus, InstallStatuses } from '@shared/contracts/minecraft';
import { Settings2 } from 'lucide-react';
import { marked } from 'marked';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Carousel } from './Carousel';
import { ClientSettingsModal } from './ClientSettingsModal';
import { PlayButton } from './PlayButton';
import { ServersInfo } from './ServersInfo';
import { StrapiMedia } from './StrapiMedia';

type ClientOverviewProps = {
  client: Client;
};

const SETTABLE_STATUSES: ReadonlySet<InstallStatus> = new Set([
  InstallStatuses.INSTALLED,
  InstallStatuses.LAUNCHING,
  InstallStatuses.RUNNING,
  InstallStatuses.REPAIRING,
  InstallStatuses.UNINSTALLING,
]);

const SETTINGS_DISABLED_STATUSES: ReadonlySet<InstallStatus> = new Set([
  InstallStatuses.REPAIRING,
  InstallStatuses.UNINSTALLING,
  InstallStatuses.INSTALLING,
]);

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-3 text-[10px] font-bold uppercase tracking-eyebrow text-glass/40">{children}</p>
);

export const ClientOverview = ({ client }: ClientOverviewProps) => {
  const { t } = useTranslation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const runtimeState = useClientStatus(client.slug);
  const isSettable = SETTABLE_STATUSES.has(runtimeState.status);
  const isSettingsDisabled = SETTINGS_DISABLED_STATUSES.has(runtimeState.status);
  const {
    title,
    shortDescription,
    description,
    screenshots,
    servers,
    titleImage,
    keywords,
    minecraftVersion,
  } = client;

  const parsedDescription = useMemo(() => marked.parse(description ?? '') as string, [description]);

  const hasScreenshots = (screenshots?.length ?? 0) > 0;
  const hasAbout = Boolean(description);
  const hasServers = Boolean(servers?.length);
  const hasBelow = hasScreenshots || hasAbout;

  return (
    <>
      <div className="flex flex-col">
        <section className="flex flex-col gap-6 px-12 pb-12 pt-6">
          <div className="flex max-w-[560px] flex-col gap-5">
            {titleImage ? (
              <div className="flex h-22 max-w-[410px] items-start">
                <StrapiMedia
                  media={titleImage}
                  className="h-full w-auto object-contain object-left drop-shadow-[0_8px_24px_var(--color-glow-overlay-lg)]"
                />
              </div>
            ) : (
              <h1 className="text-5xl font-black leading-[1.05] tracking-tight drop-shadow-[0_4px_16px_var(--color-glow-overlay-md)]">
                {title}
              </h1>
            )}

            {(minecraftVersion || (keywords?.length ?? 0) > 0) && (
              <div className="flex flex-wrap gap-1.5">
                {minecraftVersion && (
                  <span className="rounded-full border border-edge-md bg-chip-dark px-2.5 py-1 text-[11px] font-semibold tracking-wide text-glass/85 backdrop-blur-sm">
                    Minecraft {minecraftVersion}
                  </span>
                )}
                {keywords?.map((keyword) => (
                  <span
                    key={keyword.id}
                    className="rounded-full border border-edge bg-chip px-2.5 py-1 text-[11px] font-medium text-glass/55 backdrop-blur-sm"
                  >
                    {keyword.title}
                  </span>
                ))}
              </div>
            )}

            {shortDescription && (
              <p className="max-w-[460px] text-sm leading-relaxed text-glass/75 drop-shadow">
                {shortDescription}
              </p>
            )}
          </div>

          {/* Launch row lives outside the 560-wide column so the install
              progress card (4-step stepper) can render at its natural width
              without being cramped by the narrower content gutter above. */}
          <div className="flex max-w-[720px] flex-wrap items-start gap-3">
            <PlayButton client={client} />
            {isSettable && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                aria-label={t('clientSettings.openAria')}
                disabled={isSettingsDisabled}
                className="group relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-glass/15 to-glass/5 text-glass/75 ring-1 ring-edge-md backdrop-blur-md transition-all duration-150 hover:from-glass/20 hover:to-glass/10 hover:text-glass hover:ring-edge-xl active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-glass/50 disabled:opacity-50"
                style={{
                  boxShadow:
                    'inset 0 1px 0 rgba(255,255,255,0.10), 0 6px 18px -8px var(--color-glow-overlay-md)',
                }}
              >
                <Settings2
                  size={16}
                  className="transition-transform duration-200 group-hover:rotate-45"
                />
              </button>
            )}
          </div>

          {hasServers && servers && (
            <div className="max-w-[520px]">
              <SectionLabel>{t('clients.servers')}</SectionLabel>
              <ServersInfo servers={servers} />
            </div>
          )}
        </section>

        {hasBelow && (
          <div className="flex flex-col gap-10 px-12 pb-16">
            {hasScreenshots && screenshots && (
              <section>
                <SectionLabel>{t('clients.screenshots')}</SectionLabel>
                <Carousel autoPlay>
                  {screenshots.map((screenshot) => (
                    <div
                      key={screenshot.id}
                      className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-edge"
                    >
                      <StrapiMedia media={screenshot} className="h-full w-full object-cover" />
                    </div>
                  ))}
                </Carousel>
              </section>
            )}

            {hasAbout && (
              <section>
                <SectionLabel>{t('clients.about')}</SectionLabel>
                <div
                  className="prose prose-invert prose-sm max-w-none text-glass/60 [&_a]:text-glass/75 [&_h1]:text-glass/90 [&_h2]:text-glass/85 [&_h3]:text-glass/80 [&_img]:h-auto [&_img]:w-full [&_img]:rounded-lg [&_strong]:text-glass/80"
                  // biome-ignore lint/security/noDangerouslySetInnerHtml: description is admin-authored in Strapi, parsed via `marked`
                  dangerouslySetInnerHTML={{ __html: parsedDescription }}
                />
              </section>
            )}
          </div>
        )}
      </div>

      <ClientSettingsModal
        isOpen={settingsOpen}
        client={client}
        onClose={() => setSettingsOpen(false)}
      />
    </>
  );
};
