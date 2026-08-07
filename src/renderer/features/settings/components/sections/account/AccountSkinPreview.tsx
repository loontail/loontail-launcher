import { SkinViewerCard } from '@renderer/features/skin';
import { Loader2 } from 'lucide-react';
import { Suspense } from 'react';

const VIEWER_WIDTH = 180;
const VIEWER_HEIGHT = 220;

type AccountSkinPreviewProps = {
  skinUrl: string;
  capeUrl: string | undefined;
};

export const AccountSkinPreview = ({ skinUrl, capeUrl }: AccountSkinPreviewProps) => (
  <Suspense
    fallback={
      <div
        className="flex shrink-0 items-center justify-center rounded-md border border-edge bg-canvas"
        style={{ width: VIEWER_WIDTH, height: VIEWER_HEIGHT }}
      >
        <Loader2 className="size-5 animate-spin text-text-mute" />
      </div>
    }
  >
    <SkinViewerCard
      width={VIEWER_WIDTH}
      height={VIEWER_HEIGHT}
      skinUrl={skinUrl}
      capeUrl={capeUrl}
      className="bg-canvas"
    />
  </Suspense>
);
