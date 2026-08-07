import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import type { Media } from '@shared/contracts/media';

type RemoteMediaProps = {
  media: Media;
  className?: string | undefined;
  onError?: (() => void) | undefined;
};

export const RemoteMedia = ({ media, className, onError }: RemoteMediaProps) => (
  <img
    src={toCachedMediaUrl(media.url)}
    alt=""
    loading="lazy"
    decoding="async"
    className={className}
    onError={onError}
  />
);
