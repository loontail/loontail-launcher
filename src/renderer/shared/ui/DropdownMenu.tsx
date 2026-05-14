import { cn } from '@renderer/shared/lib/cn';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';

type DropdownMenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
};

export const DropdownMenu = ({ trigger, children, align = 'end' }: DropdownMenuProps) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button type="button" onClick={() => setOpen((value) => !value)} className="contents">
        {trigger}
      </button>
      {open && (
        <div
          className={cn(
            'absolute z-50 mt-1 min-w-32 overflow-hidden rounded-sm border border-border bg-popover text-popover-foreground shadow-lg',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          <DropdownMenuContext.Provider value={() => setOpen(false)}>
            {children}
          </DropdownMenuContext.Provider>
        </div>
      )}
    </div>
  );
};

type DropdownMenuItemProps = {
  onSelect: () => void;
  children: ReactNode;
};

export const DropdownMenuItem = ({ onSelect, children }: DropdownMenuItemProps) => {
  const closeMenu = useDropdownMenuClose();
  const handleClick = useCallback(() => {
    onSelect();
    closeMenu();
  }, [onSelect, closeMenu]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="block w-full cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted"
    >
      {children}
    </button>
  );
};

import { createContext, useContext } from 'react';

const DropdownMenuContext = createContext<() => void>(() => {});

const useDropdownMenuClose = (): (() => void) => useContext(DropdownMenuContext);
