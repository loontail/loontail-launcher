import defaultCape from '@renderer/assets/default-cape.png';
import defaultSkin from '@renderer/assets/default-skin.png';
import { useCurrentUser } from '@renderer/features/auth';
import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import { DropdownMenu, DropdownMenuItem } from '@renderer/shared/ui/DropdownMenu';
import { type SkinKind, SkinKinds } from '@shared/contracts/skin';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WalkingAnimation } from 'skinview3d';
import { useClearSkin, useUploadSkin } from '../hooks';
import { SkinViewer } from './SkinViewer';

const VIEWER_HEIGHT = 280;

type SkinEditorProps = {
  width?: number;
};

export const SkinEditor = ({ width = 200 }: SkinEditorProps) => {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const { mutate: upload, isPending: isUploading } = useUploadSkin();
  const { mutate: clearAll, isPending: isClearing } = useClearSkin();

  const remoteSkin = user?.skin ? toCachedMediaUrl(user.skin) : null;
  const remoteCape = user?.cape ? toCachedMediaUrl(user.cape) : null;

  const [skinUrl, setSkinUrl] = useState<string>(remoteSkin ?? defaultSkin);
  const [capeUrl, setCapeUrl] = useState<string>(remoteCape ?? defaultCape);
  const [pendingSkin, setPendingSkin] = useState<File | null>(null);
  const [pendingCape, setPendingCape] = useState<File | null>(null);

  const skinBlobRef = useRef<string | null>(null);
  const capeBlobRef = useRef<string | null>(null);
  const skinInputRef = useRef<HTMLInputElement>(null);
  const capeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (skinBlobRef.current) URL.revokeObjectURL(skinBlobRef.current);
      if (capeBlobRef.current) URL.revokeObjectURL(capeBlobRef.current);
    };
  }, []);

  useEffect(() => {
    if (pendingSkin === null) {
      setSkinUrl(remoteSkin ?? defaultSkin);
    }
  }, [remoteSkin, pendingSkin]);

  useEffect(() => {
    if (pendingCape === null) {
      setCapeUrl(remoteCape ?? defaultCape);
    }
  }, [remoteCape, pendingCape]);

  const handleFileChange = (kind: SkinKind) => (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const objectUrl = URL.createObjectURL(file);
    if (kind === SkinKinds.SKIN) {
      if (skinBlobRef.current) URL.revokeObjectURL(skinBlobRef.current);
      skinBlobRef.current = objectUrl;
      setSkinUrl(objectUrl);
      setPendingSkin(file);
    } else {
      if (capeBlobRef.current) URL.revokeObjectURL(capeBlobRef.current);
      capeBlobRef.current = objectUrl;
      setCapeUrl(objectUrl);
      setPendingCape(file);
    }
  };

  const handleSave = async () => {
    if (pendingSkin) {
      const buffer = await pendingSkin.arrayBuffer();
      await upload({ type: SkinKinds.SKIN, buffer });
      if (skinBlobRef.current) {
        URL.revokeObjectURL(skinBlobRef.current);
        skinBlobRef.current = null;
      }
      setPendingSkin(null);
    }
    if (pendingCape) {
      const buffer = await pendingCape.arrayBuffer();
      await upload({ type: SkinKinds.CAPE, buffer });
      if (capeBlobRef.current) {
        URL.revokeObjectURL(capeBlobRef.current);
        capeBlobRef.current = null;
      }
      setPendingCape(null);
    }
  };

  const handleReset = async () => {
    await clearAll();
    if (skinBlobRef.current) {
      URL.revokeObjectURL(skinBlobRef.current);
      skinBlobRef.current = null;
    }
    if (capeBlobRef.current) {
      URL.revokeObjectURL(capeBlobRef.current);
      capeBlobRef.current = null;
    }
    setSkinUrl(defaultSkin);
    setCapeUrl(defaultCape);
    setPendingSkin(null);
    setPendingCape(null);
  };

  const isDirty = pendingSkin !== null || pendingCape !== null;
  const hasCustom = (remoteSkin !== null || remoteCape !== null) && !isDirty;

  return (
    <div className="flex flex-col" style={{ width }}>
      <input
        ref={skinInputRef}
        type="file"
        accept=".png"
        hidden
        onChange={handleFileChange(SkinKinds.SKIN)}
      />
      <input
        ref={capeInputRef}
        type="file"
        accept=".png"
        hidden
        onChange={handleFileChange(SkinKinds.CAPE)}
      />

      <div
        className="relative overflow-hidden rounded-md border border-border bg-card"
        style={{ width, height: VIEWER_HEIGHT }}
      >
        <SkinViewer
          width={width}
          height={VIEWER_HEIGHT}
          skinUrl={skinUrl}
          capeUrl={capeUrl}
          options={{ zoom: 0.8 }}
          onReady={({ viewer }) => {
            viewer.animation = new WalkingAnimation();
            viewer.autoRotate = true;
            viewer.autoRotateSpeed = 0.3;
          }}
        />

        {hasCustom && (
          <button
            type="button"
            onClick={() => void handleReset()}
            disabled={isClearing}
            aria-label="Reset skin"
            className="absolute left-2 top-2 rounded-sm bg-background/60 p-1.5 text-foreground transition-colors hover:bg-background/80 disabled:opacity-50"
          >
            {isClearing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
          </button>
        )}

        <div className="absolute right-2 top-2">
          <DropdownMenu
            trigger={
              <span className="inline-flex rounded-sm bg-background/60 p-1.5 text-foreground transition-colors hover:bg-background/80">
                <Pencil className="size-3.5" />
              </span>
            }
          >
            <DropdownMenuItem onSelect={() => skinInputRef.current?.click()}>
              {t('settings.account.changeSkin')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => capeInputRef.current?.click()}>
              {t('settings.account.changeCape')}
            </DropdownMenuItem>
          </DropdownMenu>
        </div>

        {isDirty && (
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isUploading}
            className="absolute bottom-0 left-0 right-0 bg-primary py-2 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            {isUploading ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                {t('settings.account.skinSaving')}
              </span>
            ) : (
              t('settings.account.skinSave')
            )}
          </button>
        )}
      </div>
    </div>
  );
};
