import { useEffect, useRef, useState } from 'react';
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
  const [failed, setFailed] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: viewer must mount exactly once; prop changes handled by dedicated effects below
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let viewer: SkinView3d;
    try {
      // WebGL context creation throws on a disabled/absent GPU; contain it here so
      // a viewer failure can't unmount the whole Settings tree via the root boundary.
      viewer = new SkinView3d({ canvas, width, height, ...options });
    } catch (error) {
      // biome-ignore lint/suspicious/noConsole: best-effort diagnostic — main logger unreachable from renderer
      console.warn('[skin] failed to initialize 3D viewer', error);
      setFailed(true);
      return;
    }
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

  if (failed) {
    return <div className={className} aria-hidden="true" style={{ width, height }} />;
  }

  return <canvas ref={canvasRef} className={className} />;
};
