import { useEffect, useRef } from 'react';
import { SkinViewer as SkinView3d } from 'skinview3d';

type SkinViewerOptions = ConstructorParameters<typeof SkinView3d>[0];

type SkinViewerProps = {
  width: number;
  height: number;
  skinUrl?: string | undefined;
  capeUrl?: string | undefined;
  options?: SkinViewerOptions;
  onReady?: (args: { viewer: SkinView3d; canvas: HTMLCanvasElement }) => void;
  className?: string;
};

export const SkinViewer = ({
  width,
  height,
  skinUrl,
  capeUrl,
  options,
  onReady,
  className,
}: SkinViewerProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<SkinView3d | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewer must mount exactly once; prop changes handled by dedicated effects below
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewer = new SkinView3d({ canvas, width, height, ...options });
    if (skinUrl) void viewer.loadSkin(skinUrl);
    if (capeUrl) void viewer.loadCape(capeUrl);
    viewerRef.current = viewer;
    onReady?.({ viewer, canvas });
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (skinUrl) void viewer.loadSkin(skinUrl);
    else viewer.resetSkin();
  }, [skinUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    if (capeUrl) void viewer.loadCape(capeUrl);
    else viewer.resetCape();
  }, [capeUrl]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.setSize(width, height);
  }, [width, height]);

  return <canvas ref={canvasRef} className={className} />;
};
