import type { StrapiImageFormat, StrapiMedia as StrapiMediaType } from '@shared/contracts/strapi';

type StrapiMediaProps = {
  media: StrapiMediaType;
  className?: string;
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

export const StrapiMedia = ({ media, className }: StrapiMediaProps) => (
  <img src={pickBestUrl(media)} alt={media.name} className={className} />
);
