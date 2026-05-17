import { cn } from '@renderer/shared/lib/cn';
import { useEffect } from 'react';
import { useClientsList } from '../hooks';
import { useActiveClientId, useSetActiveClientId } from '../store';
import { ClientOverview } from './ClientOverview';
import { ClientsNavigation } from './ClientsNavigation';
import { StrapiMedia } from './StrapiMedia';

export const ClientsPage = () => {
  const { clients, isPending } = useClientsList();
  const activeClientId = useActiveClientId();
  const setActiveClientId = useSetActiveClientId();

  useEffect(() => {
    const first = clients[0];
    if (!first) return;
    const stillExists = clients.some((client) => client.id === activeClientId);
    if (!stillExists) {
      setActiveClientId(first.id);
    }
  }, [clients, activeClientId, setActiveClientId]);

  const activeClient = clients.find((client) => client.id === activeClientId) ?? null;
  const showNav = isPending || clients.length > 1;

  return (
    <div className="relative flex h-full">
      {activeClient?.background && (
        <div
          key={activeClient.id}
          className={cn('fixed inset-0 z-0', !activeClient.available && 'grayscale')}
          aria-hidden="true"
        >
          <StrapiMedia
            media={activeClient.background}
            className="h-full w-full object-cover brightness-[0.55]"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-overlay/85 via-overlay/55 to-overlay/15" />
          <div className="absolute inset-0 bg-gradient-to-t from-overlay/90 via-overlay/30 to-transparent" />
          <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-overlay/70 to-transparent" />
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[340px] bg-gradient-to-l from-overlay/75 to-transparent" />
        </div>
      )}

      <div className="relative z-10 flex flex-1 justify-center overflow-hidden">
        <div className="flex w-full max-w-[1080px]">
          <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
            {activeClient && <ClientOverview key={activeClient.id} client={activeClient} />}
          </div>
          {showNav && (
            <div className="w-[296px] shrink-0">
              <ClientsNavigation
                clients={clients}
                activeClientId={activeClientId}
                isPending={isPending}
                onSelect={setActiveClientId}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
