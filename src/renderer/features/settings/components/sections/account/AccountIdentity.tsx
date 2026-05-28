import { Button } from '@renderer/shared/ui/Button';
import { CopyButton } from '@renderer/shared/ui/CopyButton';
import { LoontailMarkIcon } from '@renderer/shared/ui/icons/LoontailMarkIcon';
import { MicrosoftIcon } from '@renderer/shared/ui/icons/MicrosoftIcon';
import type { AuthProvider } from '@shared/contracts/auth';
import { Loader2, LogOut } from 'lucide-react';

const EMPTY_USERNAME = '\u2014';

export type AccountProviderChip = {
  provider: AuthProvider;
  label: string;
};

type AccountSpecs = {
  skinLabel: string;
  skin: string;
  capeLabel: string;
  cape: string | null;
};

type AccountIdentityLabels = {
  copyUsername: string;
  usernameCopied: string;
  logout: string;
};

type AccountLogoutAction = {
  isPending: boolean;
  onClick: () => void;
};

type AccountIdentityProps = {
  username: string | null;
  providerChip: AccountProviderChip | null;
  specs: AccountSpecs;
  helper: string;
  labels: AccountIdentityLabels;
  logoutAction: AccountLogoutAction;
};

export const AccountIdentity = ({
  username,
  providerChip,
  specs,
  helper,
  labels,
  logoutAction,
}: AccountIdentityProps) => (
  <div className="flex min-w-0 flex-1 flex-col gap-3">
    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <h1
        className="selectable min-w-0 truncate text-2xl font-semibold leading-tight text-foreground"
        title={username ?? undefined}
      >
        {username ?? EMPTY_USERNAME}
      </h1>
      {username !== null && (
        <CopyButton
          text={username}
          copyLabel={labels.copyUsername}
          copiedLabel={labels.usernameCopied}
        />
      )}
      {providerChip !== null && <ProviderChip chip={providerChip} />}
    </div>

    <dl className="flex flex-col gap-1.5 rounded-md border border-edge bg-surface/40 px-3 py-2 text-xs">
      <SpecRow term={specs.skinLabel} value={specs.skin} />
      {specs.cape !== null && <SpecRow term={specs.capeLabel} value={specs.cape} />}
    </dl>

    <p className="text-xs leading-relaxed text-muted-foreground">{helper}</p>

    <div className="mt-auto flex justify-end">
      <Button
        variant="destructive"
        size="sm"
        onClick={logoutAction.onClick}
        disabled={logoutAction.isPending}
        className="gap-1.5 whitespace-nowrap"
      >
        {logoutAction.isPending ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <LogOut className="size-3.5" />
        )}
        {labels.logout}
      </Button>
    </div>
  </div>
);

type SpecRowProps = { term: string; value: string };

const SpecRow = ({ term, value }: SpecRowProps) => (
  <div className="flex items-baseline gap-3">
    <dt className="w-12 shrink-0 text-microlabel font-semibold uppercase tracking-eyebrow text-muted-foreground">
      {term}
    </dt>
    <dd className="min-w-0 truncate text-foreground" title={value}>
      {value}
    </dd>
  </div>
);

type ProviderChipProps = { chip: AccountProviderChip };

const ProviderChip = ({ chip }: ProviderChipProps) => (
  <span className="inline-flex h-6 items-center gap-1.5 rounded-md border border-edge bg-surface px-2 text-eyebrow font-medium text-foreground/80">
    {chip.provider === 'mojang' ? (
      <MicrosoftIcon className="size-3" />
    ) : (
      <LoontailMarkIcon className="size-3 text-glass/80" />
    )}
    {chip.label}
  </span>
);
