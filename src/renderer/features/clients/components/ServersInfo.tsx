import { cn } from '@renderer/shared/lib/cn';
import { Skeleton } from '@renderer/shared/ui/Skeleton';
import type { Server } from '@shared/contracts/strapi';
import { useTranslation } from 'react-i18next';
import { useServerStatuses } from '../hooks';

type ServersInfoProps = {
  servers: Server[];
};

export const ServersInfo = ({ servers }: ServersInfoProps) => {
  const { t } = useTranslation();
  const addresses = servers.map((server) => server.address);
  const query = useServerStatuses(addresses);

  if (query.isPending || !query.data) {
    return (
      <div className="flex flex-col gap-2">
        {servers.map((server) => (
          <div
            key={server.address}
            className="flex items-center justify-between gap-4 rounded-xl border border-edge bg-surface px-4 py-3 backdrop-blur-sm"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-glass/30" />
              <div className="flex h-9 min-w-0 flex-col justify-center gap-1">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-3 w-40" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const statuses = query.data;
  const anyOnline = statuses.some((status) => status.online);

  if (!anyOnline) {
    return (
      <div className="flex items-center gap-2.5 rounded-xl border border-edge bg-surface px-4 py-3 backdrop-blur-sm">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive/50" />
        <span className="text-xs text-glass/45">{t('servers.offline')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {statuses.map((status, index) => {
        const server = servers[index];
        if (!server) return null;
        const displayName = server.name ?? status.motd?.clean[0] ?? server.address;

        const hasPlayerCount = status.online && status.players;

        return (
          <div
            key={server.address}
            className={cn(
              'flex items-center justify-between gap-4 rounded-xl border border-edge bg-surface px-4 py-3 backdrop-blur-sm',
              !status.online && 'opacity-60',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  status.online
                    ? 'bg-success/85 shadow-[0_0_6px_var(--color-glow-success)]'
                    : 'bg-destructive/40',
                )}
              />
              <div className="flex h-9 min-w-0 flex-col justify-center">
                <span className="truncate text-[13px] font-semibold leading-5 text-glass">
                  {displayName}
                </span>
                <span className="truncate text-[11px] leading-4 text-glass/45">
                  {server.address}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-[11px]">
              {hasPlayerCount && status.players && (
                <>
                  <span className="tabular-nums text-glass/75">
                    {status.players.online}
                    <span className="text-glass/40"> / {status.players.max}</span>
                  </span>
                  <span className="text-glass/30">·</span>
                </>
              )}
              <span
                className={cn(
                  'font-bold uppercase tracking-wider',
                  status.online ? 'text-success/85' : 'text-destructive/75',
                )}
              >
                {status.online ? t('servers.online') : t('servers.serverOffline')}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
