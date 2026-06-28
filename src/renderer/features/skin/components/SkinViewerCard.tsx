import { cn } from '@renderer/shared/lib/cn';
import { useCallback } from 'react';
import { type SkinViewer as SkinView3d, WalkingAnimation } from 'skinview3d';
import { SkinViewer } from './SkinViewer';

type SkinViewerCardProps = {
  width: number;
  height: number;
  skinUrl: string;
  capeUrl?: string | undefined;
  className?: string;
};

export const SkinViewerCard = ({
  width,
  height,
  skinUrl,
  capeUrl,
  className,
}: SkinViewerCardProps) => {
  const handleReady = useCallback(({ viewer }: { viewer: SkinView3d }) => {
    viewer.animation = new WalkingAnimation();
    viewer.autoRotate = true;
    viewer.autoRotateSpeed = 0.4;
  }, []);

  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md border border-border bg-card',
        className,
      )}
      style={{ width, height }}
    >
      <SkinViewer
        width={width}
        height={height}
        skinUrl={skinUrl}
        capeUrl={capeUrl}
        options={{ zoom: 0.85 }}
        onReady={handleReady}
      />
    </div>
  );
};
