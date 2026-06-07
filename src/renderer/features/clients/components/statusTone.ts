import type { BuildStatusTone } from './buildStatus';

// Presentation maps for a build's install status, used by the compact dot+label
// status marker on the home client cards.
export const STATUS_DOT_CLASSES: Record<BuildStatusTone, string> = {
  ready: 'bg-success/90',
  active: 'bg-primary',
  pending: 'bg-glass/60',
  idle: 'bg-glass/35',
  error: 'bg-destructive/80',
};

export const STATUS_TEXT_CLASSES: Record<BuildStatusTone, string> = {
  ready: 'text-success/80',
  active: 'text-primary',
  pending: 'text-glass/60',
  idle: 'text-glass/45',
  error: 'text-destructive/90',
};
