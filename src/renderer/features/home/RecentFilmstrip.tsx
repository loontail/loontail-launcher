import { BuildMedia } from '@renderer/features/builds';
import { cn } from '@renderer/shared/lib/cn';
import type { CatalogItem } from '@shared/contracts/catalog';
import { type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';

type RecentFilmstripProps = {
  items: CatalogItem[];
  activeIndex: number;
  onSelect: (index: number) => void;
};

export const RecentFilmstrip = ({ items, activeIndex, onSelect }: RecentFilmstripProps) => {
  const { t } = useTranslation();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const moveTo = (index: number): void => {
    const next = (index + items.length) % items.length;
    onSelect(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') moveTo(index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') moveTo(index - 1);
    else if (event.key === 'Home') moveTo(0);
    else if (event.key === 'End') moveTo(items.length - 1);
    else return;
    event.preventDefault();
  };

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-microlabel font-bold uppercase tracking-eyebrow text-text-mute">
        {t('home.recent')}
      </span>
      <div
        role="radiogroup"
        aria-label={t('home.recent')}
        className="flex gap-3 overflow-x-auto pb-1"
      >
        {items.map((item, index) => {
          const active = index === activeIndex;
          return (
            // biome-ignore lint/a11y/useSemanticElements: carousel selector uses radio buttons, not native inputs
            <button
              key={item.key}
              ref={(el) => {
                refs.current[index] = el;
              }}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={item.presentation.title}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'group relative h-24 w-44 shrink-0 overflow-hidden rounded-lg border-2 text-left transition-all duration-150 ease-standard',
                'focus-visible:outline-none focus-visible:border-text-hi',
                active
                  ? 'border-text-hi'
                  : 'border-transparent opacity-60 hover:border-edge-lg hover:opacity-100',
              )}
            >
              <BuildMedia
                item={item}
                slot="background"
                fallback="visual"
                className="absolute inset-0 size-full object-cover transition-transform duration-300 ease-standard motion-safe:group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-linear-to-t from-overlay/95 via-overlay/45 to-transparent" />
              <span className="absolute inset-x-2.5 bottom-2 truncate text-caption font-semibold text-text-hi">
                {item.presentation.title}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
