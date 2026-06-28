import { type CatalogItem, isOfficial } from '@shared/contracts/catalog';
import { type ReactNode, useState } from 'react';
import { BuildVisualFallback } from './BuildVisualFallback';
import { RemoteMedia } from './RemoteMedia';
import { localBackgroundFor } from './localBackgrounds';

type MediaSlot = 'poster' | 'background' | 'titleImage';

// What to render if the image is absent or fails to load: a generated visual
// (good for covers/backdrops) or nothing (logos/screenshots, where a gradient
// block would look wrong).
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

// Renders a build's media regardless of source: official builds render their
// API media (cached protocol) via their raw Client; local builds render their
// on-disk media URL. A missing or broken image degrades to the configured
// fallback instead of a blank/collapsed box.
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
    return <img src={ref.url} alt="" className={className} onError={() => setFailed(true)} />;
  // Personal builds rarely ship key-art; give the backdrop slot a stable, seeded
  // Minecraft screenshot instead of a flat gradient. Other slots keep the gradient.
  if (slot === 'background') {
    return (
      <img
        src={localBackgroundFor(item.key)}
        alt=""
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
  return <img src={ref.url} alt="" className={className} onError={() => setFailed(true)} />;
};
