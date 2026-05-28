import type { Translator } from '@renderer/i18n';
import {
  type ConsoleProcessStatus,
  type ConsoleSource,
  ConsoleStatuses,
} from '@shared/contracts/console';
import type { ReactNode } from 'react';

const TWO_DIGITS = 2;
const THREE_DIGITS = 3;

const pad = (value: number, width: number): string => `${value}`.padStart(width, '0');

export const formatTime = (timestamp: number): string => {
  const date = new Date(timestamp);
  return (
    `${pad(date.getHours(), TWO_DIGITS)}:${pad(date.getMinutes(), TWO_DIGITS)}:` +
    `${pad(date.getSeconds(), TWO_DIGITS)}.${pad(date.getMilliseconds(), THREE_DIGITS)}`
  );
};

export const sourceLabelKey = (source: ConsoleSource): string => `console.source.${source}`;

export const formatSearchCounter = (
  searchQuery: string,
  matchesCount: number,
  activeMatchIndex: number,
  t: Translator,
): string => {
  if (!searchQuery) return '';
  if (matchesCount === 0) return t('console.noMatches');
  return t('console.matches', {
    current: activeMatchIndex + 1,
    total: matchesCount,
  });
};

type HighlightProps = {
  message: string;
  query: string;
  active: boolean;
};

export const Highlight = ({ message, query, active }: HighlightProps): ReactNode => {
  if (!query) return message;
  const needle = query.toLowerCase();
  const haystack = message.toLowerCase();
  const parts: ReactNode[] = [];
  let cursor = 0;
  let matchIndex = 0;
  while (cursor < message.length) {
    const next = haystack.indexOf(needle, cursor);
    if (next === -1) {
      parts.push(message.slice(cursor));
      break;
    }
    if (next > cursor) parts.push(message.slice(cursor, next));
    parts.push(
      <span
        key={`${next}-${matchIndex}`}
        className="console-highlight"
        data-active={active && matchIndex === 0 ? 'true' : undefined}
      >
        {message.slice(next, next + needle.length)}
      </span>,
    );
    cursor = next + needle.length;
    matchIndex++;
  }
  return parts;
};

export const COPY_FEEDBACKS = {
  IDLE: 'idle',
  SUCCESS: 'success',
  ERROR: 'error',
} as const;

export type CopyFeedback = (typeof COPY_FEEDBACKS)[keyof typeof COPY_FEEDBACKS];

export const copyFeedbackLabel = (
  feedback: CopyFeedback,
  idleLabel: string,
  t: Translator,
): string => {
  if (feedback === COPY_FEEDBACKS.SUCCESS) return t('console.copied');
  if (feedback === COPY_FEEDBACKS.ERROR) return t('console.copyFailed');
  return idleLabel;
};

export const statusToneClass = (status: ConsoleProcessStatus): string => {
  switch (status) {
    case ConsoleStatuses.RUNNING:
      return 'border-success/40 text-success';
    case ConsoleStatuses.LAUNCHING:
      return 'border-edge-lg text-foreground';
    case ConsoleStatuses.CRASHED:
    case ConsoleStatuses.ERROR:
      return 'border-destructive/50 text-destructive';
    case ConsoleStatuses.EXITED:
      return 'border-edge-md text-foreground/60';
    default:
      return 'border-edge-md text-foreground/55';
  }
};
