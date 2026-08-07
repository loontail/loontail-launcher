import { type CatalogItem, isOfficial } from '@shared/contracts/catalog';
import { type ReactNode, useState } from 'react';
import { BuildVisualFallback } from './BuildVisualFallback';
import { localBackgroundFor } from './localBackgrounds';
import { RemoteMedia } from './RemoteMedia';

type MediaSlot = 'poster' | 'background' | 'titleImage';

type MediaFallback = 'visual' | 'none';

type BuildMediaProps = {
  item: CatalogItem;
  slot: MediaSlot;
  className?: string;
  fallback?: MediaFallback;
};

const renderFallback = (
  item: CatalogItem,
  fallback: MediaFallback,
  className?: string,
): ReactNode =>
  fallback === 'visual' ? (
    <BuildVisualFallback item={item} showInitial={false} className={className} />
  ) : null;

export const BuildMedia = ({ item, slot, className, fallback = 'visual' }: BuildMediaProps) => {
  const [failed, setFailed] = useState(false);
  if (failed) return renderFallback(item, fallback, className);

  if (isOfficial(item)) {
    const media = item.raw[slot];
    if (!media) return renderFallback(item, fallback, className);
    return <RemoteMedia media={media} className={className} onError={() => setFailed(true)} />;
  }

  const ref = item.presentation.media[slot];
  if (ref)
    return (
      <img
        src={ref.url}
        alt=""
        loading="lazy"
        decoding="async"
        className={className}
        onError={() => setFailed(true)}
      />
    );
  // Backdrop slot falls back to a key-seeded screenshot so it stays stable across renders.
  if (slot === 'background') {
    return (
      <img
        src={localBackgroundFor(item.key)}
        alt=""
        loading="lazy"
        decoding="async"
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }
  return renderFallback(item, fallback, className);
};

export const buildScreenshotCount = (item: CatalogItem): number =>
  isOfficial(item) ? item.raw.screenshots.length : item.presentation.media.screenshots.length;

type BuildScreenshotProps = {
  item: CatalogItem;
  index: number;
  className?: string;
};

export const BuildScreenshot = ({ item, index, className }: BuildScreenshotProps) => {
  const [failed, setFailed] = useState(false);
  if (failed) return null;

  if (isOfficial(item)) {
    const media = item.raw.screenshots[index];
    if (!media) return null;
    return <RemoteMedia media={media} className={className} onError={() => setFailed(true)} />;
  }

  const ref = item.presentation.media.screenshots[index];
  if (!ref) return null;
  return (
    <img
      src={ref.url}
      alt=""
      loading="lazy"
      decoding="async"
      className={className}
      onError={() => setFailed(true)}
    />
  );
};
