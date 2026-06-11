import { UpdaterBadge } from '@renderer/features/updater';
import { cn } from '@renderer/shared/lib/cn';
import { PAGE_CONTAINER } from '@renderer/shared/lib/layout';
import { useCurrentRoute, useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { ArrowLeft, Boxes, House, type LucideIcon, Settings, Terminal } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openConsoleWindow } from './api';

type TopNavProps = {
  customTitleBar: boolean;
};

// The alpha marker + its hover tooltip, sat on the right of the bar (before the
// console icon) now that the wordmark is gone.
const AlphaTag = () => {
  const { t } = useTranslation();
  return (
    <span className="group relative inline-flex">
      <span className="cursor-default rounded-xs px-1.5 py-0.5 text-microlabel font-bold uppercase tracking-wider text-text-faint ring-1 ring-edge transition-colors group-hover:text-text-mute group-hover:ring-edge-lg">
        {t('appBar.alphaTag')}
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute right-0 top-full z-50 mt-2 w-64 whitespace-normal rounded-md bg-popover px-3 py-2 text-eyebrow font-medium leading-snug text-popover-foreground opacity-0 shadow-overlay ring-1 ring-edge-md transition-opacity duration-150 group-hover:opacity-100"
      >
        {t('appBar.alphaTooltip')}
      </span>
    </span>
  );
};

// A full-height, edge-to-edge control matching the native window buttons. The
// icon actions add a hover fill; the nav links opt out (text-only highlight).
const barItem =
  'app-region-no-drag relative flex h-full cursor-pointer items-center transition-colors duration-150 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60';

const NAV_ITEMS = [
  { name: 'home', icon: House },
  { name: 'builds', icon: Boxes },
] as const;

// The primary nav links + a single underline that slides to the active link.
// The underline is measured (offset + width, inset by the link padding) so it
// tracks the text/icon and lines up with the page content gutter.
const NavTabs = ({ active, onSelect }: { active: string; onSelect: (name: string) => void }) => {
  const { t } = useTranslation();
  const navRef = useRef<HTMLElement>(null);
  const [bar, setBar] = useState({ left: 0, width: 0, animate: false });

  useLayoutEffect(() => {
    const measure = (): void => {
      const tab = navRef.current?.querySelector<HTMLElement>(`[data-tab="${active}"]`);
      if (!tab) return;
      // 16px == the link's px-4, so the underline spans only the icon+label.
      setBar((prev) => ({
        left: tab.offsetLeft + 16,
        width: tab.offsetWidth - 32,
        animate: prev.width > 0,
      }));
    };
    measure();
    document.fonts?.ready.then(measure).catch(() => {});
  }, [active]);

  return (
    <nav ref={navRef} className="relative -ml-4 flex h-full" aria-label={t('nav.rail')}>
      {NAV_ITEMS.map(({ name, icon: Icon }) => {
        const isActive = active === name;
        return (
          <button
            key={name}
            data-tab={name}
            type="button"
            onClick={() => onSelect(name)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              barItem,
              'gap-2 px-4 text-caption font-semibold',
              isActive ? 'text-text-hi' : 'text-text-mute hover:text-text',
            )}
          >
            <Icon className="size-4" strokeWidth={2} aria-hidden />
            {t(`nav.${name}`)}
          </button>
        );
      })}
      <span
        aria-hidden
        className={cn(
          'absolute bottom-0 h-0.5 rounded-full bg-text-hi',
          bar.animate && 'transition-[left,width] duration-200 ease-standard',
        )}
        style={{ left: bar.left, width: bar.width }}
      />
    </nav>
  );
};

const IconAction = ({
  label,
  onClick,
  icon: Icon,
}: {
  label: string;
  onClick: () => void;
  icon: LucideIcon;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className={cn(
      barItem,
      'w-12 justify-center text-text-mute hover:bg-ghost-hover hover:text-text-hi',
    )}
  >
    <Icon className="size-4.5" strokeWidth={2} aria-hidden />
  </button>
);

// The frameless title bar + primary navigation in one row. Transparent over the
// immersive Home/detail art, solid on the flat Builds page. Build detail collapses
// the bar to a labelled back affordance on the left; Settings clears the whole bar
// and turns the settings icon (top-right, by the window controls) into a back arrow.
export const TopNav = ({ customTitleBar }: TopNavProps) => {
  const { t } = useTranslation();
  const route = useCurrentRoute();
  const stack = useNavigationStore((s) => s.stack);
  const reset = useNavigationStore((s) => s.reset);
  const push = useNavigationStore((s) => s.push);
  const pop = useNavigationStore((s) => s.pop);

  const isSettings = route.name === 'settings';
  const isBuildBack = route.name === 'build';
  const isImmersive = route.name === 'home' || route.name === 'build';
  const previous = stack[stack.length - 2];
  const backLabel = previous?.name === 'home' ? t('nav.home') : t('nav.builds');

  // Build detail shows a labelled back button on the left; settings clears the left
  // entirely (its back arrow lives in the right cluster); everything else gets nav.
  let leftContent: ReactNode = (
    <NavTabs
      active={route.name}
      onSelect={(name) => (name === 'home' ? reset({ name: 'home' }) : push({ name: 'builds' }))}
    />
  );
  if (isSettings) {
    leftContent = null;
  } else if (isBuildBack) {
    leftContent = (
      <button
        type="button"
        onClick={pop}
        className={cn(
          barItem,
          'group -ml-4 gap-2 px-4 text-caption font-semibold text-text hover:text-text-hi',
        )}
      >
        <ArrowLeft
          className="size-4.5 transition-transform duration-150 group-hover:-translate-x-0.5"
          strokeWidth={2}
        />
        {backLabel}
      </button>
    );
  }

  return (
    <header
      className={cn(
        'absolute inset-x-0 top-0 z-50 flex h-12 shrink-0 select-none items-center',
        customTitleBar && 'app-region-drag',
        isImmersive ? 'bg-linear-to-b from-overlay/50 via-overlay/15 to-transparent' : 'bg-canvas',
      )}
    >
      {/* Hairline drawn as an absolute overlay (not a box border) so it never
          changes the bar's height/centering — no 1px content shift between the
          immersive routes (no line) and the solid pages (line). */}
      {!isImmersive && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-edge/60"
          aria-hidden
        />
      )}
      {/* Left content sits in the shared page frame so the nav/back lines up with
          every route's content. The -ml-4 cancels the first item's hover padding
          so its text (not its hover box) aligns to the content gutter. */}
      <div className={cn(PAGE_CONTAINER, 'flex h-full items-center')}>{leftContent}</div>

      {/* Right cluster is pinned to the window edge (clear of the native window
          controls via title-bar-safe), independent of the centred content frame.
          Settings replaces the whole cluster with a single back arrow sitting where
          the settings icon was; build detail uses the left back affordance instead. */}
      {isSettings ? (
        <div
          className={cn(
            'absolute inset-y-0 right-0 flex items-center',
            customTitleBar && 'title-bar-safe',
          )}
        >
          <button
            type="button"
            onClick={pop}
            aria-label={t('nav.back')}
            className={cn(
              barItem,
              'group w-12 justify-center text-text-mute hover:bg-ghost-hover hover:text-text-hi',
            )}
          >
            <ArrowLeft
              className="size-4.5 transition-transform duration-150 group-hover:-translate-x-0.5"
              strokeWidth={2}
              aria-hidden
            />
          </button>
        </div>
      ) : (
        !isBuildBack && (
          <div
            className={cn(
              'absolute inset-y-0 right-0 flex items-center',
              customTitleBar && 'title-bar-safe',
            )}
          >
            <div className="app-region-no-drag flex items-center gap-2.5 pr-2">
              <AlphaTag />
              <UpdaterBadge />
            </div>
            <IconAction label={t('nav.console')} onClick={openConsoleWindow} icon={Terminal} />
            <IconAction
              label={t('nav.settings')}
              onClick={() => push({ name: 'settings' })}
              icon={Settings}
            />
          </div>
        )
      )}
    </header>
  );
};
