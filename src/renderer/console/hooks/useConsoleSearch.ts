import type { ConsoleLine } from '@shared/contracts/console';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const SEARCH_DEBOUNCE_MS = 120;
const SEARCH_RESULT_CAP = 5000;

const findMatches = (lines: ConsoleLine[], query: string): number[] => {
  if (!query) return [];
  const needle = query.toLowerCase();
  const out: number[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line?.message.toLowerCase().includes(needle)) {
      out.push(index);
      if (out.length >= SEARCH_RESULT_CAP) break;
    }
  }
  return out;
};

export type ConsoleSearchApi = {
  searchInput: string;
  setSearchInput: (value: string) => void;
  searchQuery: string;
  matches: number[];
  activeMatchIndex: number;
  activeRowIndex: number | null;
  goNextMatch: () => void;
  goPrevMatch: () => void;
  clear: () => void;
  focusSearch: () => void;
  searchInputRef: React.RefObject<HTMLInputElement | null>;
};

export const useConsoleSearch = (lines: ConsoleLine[]): ConsoleSearchApi => {
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatch, setActiveMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(() => findMatches(lines, searchQuery), [lines, searchQuery]);
  const activeMatchIndex = matches.length > 0 ? activeMatch % matches.length : 0;
  const activeRowIndex = matches.length > 0 ? (matches[activeMatchIndex] ?? null) : null;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setSearchQuery(searchInput);
      setActiveMatch(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [searchInput]);

  useEffect(() => {
    if (matches.length === 0) {
      setActiveMatch(0);
      return;
    }
    if (activeMatch >= matches.length) setActiveMatch(matches.length - 1);
  }, [matches.length, activeMatch]);

  const goNextMatch = useCallback(() => {
    if (matches.length === 0) return;
    setActiveMatch((prev) => (prev + 1) % matches.length);
  }, [matches.length]);

  const goPrevMatch = useCallback(() => {
    if (matches.length === 0) return;
    setActiveMatch((prev) => (prev - 1 + matches.length) % matches.length);
  }, [matches.length]);

  const clear = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setActiveMatch(0);
  }, []);

  const focusSearch = useCallback(() => {
    const input = searchInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  // Mirror searchInput into a ref so the keydown handler doesn't have to
  // resubscribe on every keystroke (the resubscribe gap can drop events).
  const searchInputCurrentRef = useRef(searchInput);
  useEffect(() => {
    searchInputCurrentRef.current = searchInput;
  }, [searchInput]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const isMod = event.ctrlKey || event.metaKey;
      if (isMod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        focusSearch();
        return;
      }
      const target = event.target as HTMLElement | null;
      const isInSearch = target === searchInputRef.current;
      if (!isInSearch && event.key === 'Escape' && searchInputCurrentRef.current) {
        event.preventDefault();
        clear();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [focusSearch, clear]);

  return {
    searchInput,
    setSearchInput,
    searchQuery,
    matches,
    activeMatchIndex,
    activeRowIndex,
    goNextMatch,
    goPrevMatch,
    clear,
    focusSearch,
    searchInputRef,
  };
};
