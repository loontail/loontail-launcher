import { Skeleton } from '@renderer/shared/ui/Skeleton';
import type { ClientId } from '@shared/contracts';
import type { Client } from '@shared/contracts/client';
import { PackageX } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ClientListCard } from './ClientListCard';

type ClientsNavigationProps = {
  clients: Client[];
  activeClientId: ClientId | null;
  isPending: boolean;
  onSelect: (clientId: ClientId) => void;
};

export const ClientsNavigation = ({
  clients,
  activeClientId,
  isPending,
  onSelect,
}: ClientsNavigationProps) => {
  const { t } = useTranslation();

  const renderContent = (): ReactNode => {
    if (isPending) {
      return Array.from({ length: 4 }).map((_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: skeletons have no identity
        <Skeleton key={index} className="h-16 w-full shrink-0 rounded-md" />
      ));
    }
    if (clients.length === 0) {
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <PackageX className="size-5 text-glass/20" />
          <p className="text-xs text-glass/30">{t('clients.empty')}</p>
        </div>
      );
    }
    return clients.map((client) => (
      <button
        type="button"
        key={client.id}
        onClick={() => onSelect(client.id)}
        className="cursor-pointer text-left"
      >
        <ClientListCard
          poster={client.poster}
          title={client.title}
          minecraftVersion={client.minecraftVersion}
          keywords={client.keywords}
          isActive={client.id === activeClientId}
        />
      </button>
    ));
  };

  return (
    <aside className="relative flex h-full flex-col before:pointer-events-none before:absolute before:inset-y-0 before:left-0 before:w-px before:bg-glass/15 before:[mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]">
      <div className="px-5 pb-3 pt-6">
        <p className="text-microlabel font-bold uppercase tracking-eyebrow text-glass/35">
          {t('clients.sectionTitle')}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto px-3 pb-6">
        {renderContent()}
      </div>
    </aside>
  );
};
