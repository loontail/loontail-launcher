import { cn } from '@renderer/shared/lib/cn';
import type { Client } from '@shared/contracts/client';
import { Box } from 'lucide-react';
import { StrapiMedia } from './StrapiMedia';

type ClientListCardProps = Pick<Client, 'poster' | 'title' | 'minecraftVersion' | 'keywords'> & {
  isActive?: boolean;
};

export const ClientListCard = ({
  poster,
  title,
  minecraftVersion,
  keywords,
  isActive,
}: ClientListCardProps) => (
  <div
    className={cn(
      'group relative flex h-16 cursor-pointer items-center gap-3 rounded-md px-2.5 transition-all duration-150',
      isActive ? 'bg-ghost-active ring-1 ring-edge-md' : 'hover:bg-ghost-hover',
    )}
  >
    {isActive && (
      <span className="absolute left-0 top-1/2 h-7 w-[2px] -translate-y-1/2 rounded-r-full bg-glass shadow-[0_0_6px_var(--color-glow-glass-strong)]" />
    )}

    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      {poster ? (
        <StrapiMedia media={poster} className="h-full w-full object-contain" />
      ) : (
        <Box className="size-4 text-glass/30" />
      )}
    </div>

    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span
        className={cn(
          'truncate text-sm font-semibold leading-tight',
          isActive ? 'text-glass' : 'text-glass/80 transition-colors group-hover:text-glass',
        )}
      >
        {title}
      </span>
      <div className="flex items-center gap-1.5 text-[11px] text-glass/40">
        {minecraftVersion && <span className="tabular-nums">MC {minecraftVersion}</span>}
        {keywords?.[0] && (
          <>
            <span className="opacity-50">·</span>
            <span className="truncate">{keywords[0].title}</span>
          </>
        )}
      </div>
    </div>
  </div>
);
