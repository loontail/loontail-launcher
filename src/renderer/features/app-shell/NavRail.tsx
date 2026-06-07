import { cn } from '@renderer/shared/lib/cn';
import {
  type Route,
  useCurrentRoute,
  useNavigationStore,
} from '@renderer/shared/lib/stores/navigation';
import { House, LayoutGrid, type LucideIcon, Settings, Terminal } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { openConsoleWindow } from './api';

type NavItem = {
  id: string;
  icon: LucideIcon;
  labelKey: string;
  isActive: (route: Route) => boolean;
  activate: () => void;
};

const useNavItems = (): { top: NavItem[]; bottom: NavItem[] } => {
  const reset = useNavigationStore((s) => s.reset);
  const push = useNavigationStore((s) => s.push);

  const top: NavItem[] = [
    {
      id: 'home',
      icon: House,
      labelKey: 'nav.home',
      isActive: (r) => r.name === 'home',
      activate: () => reset({ name: 'home' }),
    },
    {
      id: 'builds',
      icon: LayoutGrid,
      labelKey: 'nav.builds',
      isActive: (r) => r.name === 'builds' || r.name === 'build',
      activate: () => push({ name: 'builds' }),
    },
  ];

  const bottom: NavItem[] = [
    {
      id: 'settings',
      icon: Settings,
      labelKey: 'nav.settings',
      isActive: (r) => r.name === 'settings',
      activate: () => push({ name: 'settings' }),
    },
    {
      id: 'console',
      icon: Terminal,
      labelKey: 'nav.console',
      isActive: () => false,
      activate: openConsoleWindow,
    },
  ];

  return { top, bottom };
};

export const NavRail = () => {
  const { t } = useTranslation();
  const route = useCurrentRoute();
  const { top, bottom } = useNavItems();
  const items = [...top, ...bottom];
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activeIndex = items.findIndex((item) => item.isActive(route));
  // Roving tabindex anchor: the active item, or the first item when nothing is
  // active (e.g. on the Console pseudo-item) so exactly one button is tabbable.
  const tabbableIndex = activeIndex >= 0 ? activeIndex : 0;

  const focusItem = (index: number) => {
    const clamped = (index + items.length) % items.length;
    buttonRefs.current[clamped]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusItem(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusItem(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusItem(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusItem(items.length - 1);
    }
  };

  const renderItem = (item: NavItem, index: number) => {
    const Icon = item.icon;
    const active = item.isActive(route);
    return (
      <button
        key={item.id}
        type="button"
        ref={(el) => {
          buttonRefs.current[index] = el;
        }}
        onClick={item.activate}
        onKeyDown={(event) => handleKeyDown(event, index)}
        tabIndex={index === tabbableIndex ? 0 : -1}
        aria-current={active ? 'page' : undefined}
        aria-label={t(item.labelKey)}
        className={cn(
          'relative flex h-12 w-full cursor-pointer flex-col items-center justify-center gap-1 rounded-md transition-colors ease-standard outline-none focus-visible:ring-1 focus-visible:ring-edge-md',
          active
            ? 'bg-accent-soft text-glass'
            : 'text-glass/55 hover:bg-surface-2 hover:text-glass/80',
        )}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-glass" />
        )}
        <Icon className="size-5" aria-hidden />
        <span className="text-microlabel font-medium leading-none">{t(item.labelKey)}</span>
      </button>
    );
  };

  return (
    <nav
      aria-label={t('nav.rail')}
      className="flex w-15 shrink-0 flex-col items-stretch gap-1 bg-transparent px-1.5 py-2"
    >
      <div className="flex flex-col gap-1">{top.map((item, i) => renderItem(item, i))}</div>
      <div className="flex-1" />
      <div className="flex flex-col gap-1">
        {bottom.map((item, i) => renderItem(item, top.length + i))}
      </div>
    </nav>
  );
};
