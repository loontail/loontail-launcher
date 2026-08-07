import { useServerStatuses } from '@renderer/features/servers';
import { cn } from '@renderer/shared/lib/cn';
import { Skeleton } from '@renderer/shared/ui/Skeleton';
import type { Server } from '@shared/contracts/media';
import { useTranslation } from 'react-i18next';
import { resolveServerDisplayEntry } from './serverDisplay';

type ServersInfoProps = {
  servers: readonly Server[];
};

export const ServersInfo = ({ servers }: ServersInfoProps) => {
  const { t } = useTranslation();
  const addresses = servers.map((server) => server.address);
  const { isPending, isError, byAddress } = useServerStatuses(addresses);

  if (isError) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-edge bg-surface-1 px-4 py-3">
        <span className="h-1.5 w-1.5 rounded-full bg-warn/60" />
        <span className="text-xs text-glass/45">{t('servers.statusUnavailable')}</span>
      </div>
    );
  }

  if (isPending || !byAddress) {
    return (
      <div className="flex flex-col gap-2">
        {servers.map((server) => (
          <div
            key={server.id}
            className="flex items-center justify-between gap-4 rounded-md border border-edge bg-surface-1 px-4 py-3"
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

  const anyOnline = [...byAddress.values()].some((status) => status.online);

  if (!anyOnline) {
    return (
      <div className="flex items-center gap-2.5 rounded-md border border-edge bg-surface-1 px-4 py-3">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive/50" />
        <span className="text-xs text-glass/45">{t('servers.offline')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {servers.map((server) => {
        const status = byAddress.get(server.address);
        if (!status) return null;
        const entry = resolveServerDisplayEntry(server, status);

        return (
          <div
            key={server.id}
            className={cn(
              'flex items-center justify-between gap-4 rounded-md border border-edge bg-surface-1 px-4 py-3',
              !entry.online && 'opacity-60',
            )}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  entry.online
                    ? 'bg-success/85 shadow-[0_0_6px_var(--color-glow-success)]'
                    : 'bg-destructive/40',
                )}
              />
              <div className="flex h-9 min-w-0 flex-col justify-center">
                <span className="truncate text-progress-label font-semibold leading-5 text-glass">
                  {entry.displayName}
                </span>
                <span className="truncate text-eyebrow leading-4 text-glass/45">
                  {server.address}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2 text-eyebrow">
              {entry.players && (
                <>
                  <span className="tabular-nums text-glass/75">
                    {entry.players.online}
                    <span className="text-glass/40"> / {entry.players.max}</span>
                  </span>
                  <span className="text-glass/30">·</span>
                </>
              )}
              <span
                className={cn(
                  'font-bold uppercase tracking-wider',
                  entry.online ? 'text-success/85' : 'text-destructive/75',
                )}
              >
                {entry.online ? t('servers.online') : t('servers.serverOffline')}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};
