import { cn } from '@renderer/shared/lib/cn';
import type { ComponentType, ReactElement, SVGProps } from 'react';

export type TabItem<T extends string> = {
  id: T;
  label: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

type TabsProps<T extends string> = {
  tabs: ReadonlyArray<TabItem<T>>;
  selected: T;
  onSelect: (id: T) => void;
  className?: string;
};

export const Tabs = <T extends string>({
  tabs,
  selected,
  onSelect,
  className,
}: TabsProps<T>): ReactElement => (
  <div
    className={cn('flex gap-1 rounded-md border border-border bg-card p-1', className)}
    role="tablist"
  >
    {tabs.map((tab) => {
      const Icon = tab.icon;
      const isActive = tab.id === selected;
      return (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={isActive}
          onClick={() => onSelect(tab.id)}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-sm px-3 py-1.5 text-sm transition-colors',
            isActive
              ? 'bg-secondary text-secondary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {Icon && <Icon className="size-4" strokeWidth={1.75} />}
          <span>{tab.label}</span>
        </button>
      );
    })}
  </div>
);
