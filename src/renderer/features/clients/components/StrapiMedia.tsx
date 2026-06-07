import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import type { StrapiImageFormat, StrapiMedia as StrapiMediaType } from '@shared/contracts/strapi';

type StrapiMediaProps = {
  media: StrapiMediaType;
  className?: string | undefined;
  onError?: (() => void) | undefined;
};

const FORMAT_PRIORITY: Array<keyof StrapiMediaType['formats']> = [
  'large',
  'medium',
  'small',
  'thumbnail',
];

const pickBestUrl = (media: StrapiMediaType): string => {
  for (const key of FORMAT_PRIORITY) {
    const format = media.formats?.[key] as StrapiImageFormat | undefined;
    if (format?.url) return format.url;
  }
  return media.url;
};

export const StrapiMedia = ({ media, className, onError }: StrapiMediaProps) => (
  <img
    src={toCachedMediaUrl(pickBestUrl(media))}
    alt={media.name}
    className={className}
    onError={onError}
  />
);
