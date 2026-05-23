import defaultCape from '@renderer/assets/default-cape.png';
import defaultSkin from '@renderer/assets/default-skin.png';
import { useCurrentUser } from '@renderer/features/auth';
import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import { Button } from '@renderer/shared/ui/Button';
import { DropdownMenu, DropdownMenuItem } from '@renderer/shared/ui/DropdownMenu';
import type { SkinVariant } from '@shared/contracts/auth';
import { SkinKinds } from '@shared/contracts/skin';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { WalkingAnimation } from 'skinview3d';
import { useClearSkin, useUploadSkin } from '../hooks';
import { SkinViewer } from './SkinViewer';

const VIEWER_HEIGHT = 280;
const THUMB_SIZE = 32;

type SkinEditorProps = {
  width?: number;
};

type PendingSkin = { file: File; objectUrl: string; variant: SkinVariant | undefined };
type PendingCape = { file: File; objectUrl: string };

export const SkinEditor = ({ width = 200 }: SkinEditorProps) => {
  const { t } = useTranslation();
  const { user } = useCurrentUser();
  const provider = user?.provider ?? null;
  const skinUpload = useUploadSkin();
  const capeUpload = useUploadSkin();
  const skinClear = useClearSkin();

  const remoteSkin = user?.skin ? toCachedMediaUrl(user.skin) : null;
  const remoteCape = user?.cape ? toCachedMediaUrl(user.cape) : null;

  const [skinPending, setSkinPending] = useState<PendingSkin | null>(null);
  const [capePending, setCapePending] = useState<PendingCape | null>(null);

  const skinInputRef = useRef<HTMLInputElement>(null);
  const capeInputRef = useRef<HTMLInputElement>(null);
  // Variant requested at file-pick time. Re-read by handleSkinFile because
  // React state writes are async; a ref avoids races with rapid clicks.
  const pendingVariantRef = useRef<SkinVariant | null>(null);

  useEffect(() => {
    return () => {
      if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
      if (capePending) URL.revokeObjectURL(capePending.objectUrl);
    };
  }, [skinPending, capePending]);

  const openSkinPicker = (variant?: SkinVariant) => {
    pendingVariantRef.current = variant ?? null;
    skinInputRef.current?.click();
  };

  const openCapePicker = () => {
    capeInputRef.current?.click();
  };

  const handleSkinFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
    setSkinPending({
      file,
      objectUrl: URL.createObjectURL(file),
      variant: pendingVariantRef.current ?? undefined,
    });
  };

  const handleCapeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (capePending) URL.revokeObjectURL(capePending.objectUrl);
    setCapePending({ file, objectUrl: URL.createObjectURL(file) });
  };

  const saveSkin = async () => {
    if (!skinPending) return;
    const buffer = await skinPending.file.arrayBuffer();
    await skinUpload.mutate(
      skinPending.variant
        ? { type: SkinKinds.SKIN, buffer, variant: skinPending.variant }
        : { type: SkinKinds.SKIN, buffer },
    );
    URL.revokeObjectURL(skinPending.objectUrl);
    setSkinPending(null);
  };

  const saveCape = async () => {
    if (!capePending) return;
    const buffer = await capePending.file.arrayBuffer();
    await capeUpload.mutate({ type: SkinKinds.CAPE, buffer });
    URL.revokeObjectURL(capePending.objectUrl);
    setCapePending(null);
  };

  const cancelSkin = () => {
    if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
    setSkinPending(null);
  };

  const cancelCape = () => {
    if (capePending) URL.revokeObjectURL(capePending.objectUrl);
    setCapePending(null);
  };

  const resetAll = async () => {
    await skinClear.mutate();
    if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
    if (capePending) URL.revokeObjectURL(capePending.objectUrl);
    setSkinPending(null);
    setCapePending(null);
  };

  const previewSkinUrl = skinPending?.objectUrl ?? remoteSkin ?? defaultSkin;
  const previewCapeUrl = capePending?.objectUrl ?? remoteCape ?? defaultCape;
  const viewerCapeUrl = provider === 'mojang' ? undefined : previewCapeUrl;

  const variantHint = (() => {
    if (!skinPending?.variant) return undefined;
    return skinPending.variant === 'CLASSIC'
      ? t('settings.account.variantClassic')
      : t('settings.account.variantSlim');
  })();

  const skinMenu: ReactNode =
    provider === 'mojang' ? (
      <>
        <DropdownMenuItem onSelect={() => openSkinPicker('CLASSIC')}>
          {t('settings.account.changeSkinClassic')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => openSkinPicker('SLIM')}>
          {t('settings.account.changeSkinSlim')}
        </DropdownMenuItem>
        {remoteSkin && (
          <DropdownMenuItem onSelect={() => void resetAll()}>
            {t('settings.account.resetToDefault')}
          </DropdownMenuItem>
        )}
      </>
    ) : (
      <>
        <DropdownMenuItem onSelect={() => openSkinPicker()}>
          {t('settings.account.changeSkin')}
        </DropdownMenuItem>
        {remoteSkin && (
          <DropdownMenuItem onSelect={() => void resetAll()}>
            {t('settings.account.resetToDefault')}
          </DropdownMenuItem>
        )}
      </>
    );

  const capeMenu: ReactNode = (
    <>
      <DropdownMenuItem onSelect={openCapePicker}>
        {t('settings.account.changeCape')}
      </DropdownMenuItem>
      {remoteCape && (
        <DropdownMenuItem onSelect={() => void resetAll()}>
          {t('settings.account.resetToDefault')}
        </DropdownMenuItem>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-3" style={{ width }}>
      <input type="file" accept=".png" hidden ref={skinInputRef} onChange={handleSkinFile} />
      <input type="file" accept=".png" hidden ref={capeInputRef} onChange={handleCapeFile} />

      <div
        className="overflow-hidden rounded-md border border-border bg-card"
        style={{ width, height: VIEWER_HEIGHT }}
      >
        <SkinViewer
          width={width}
          height={VIEWER_HEIGHT}
          skinUrl={previewSkinUrl}
          capeUrl={viewerCapeUrl}
          options={{ zoom: 0.8 }}
          onReady={({ viewer }) => {
            viewer.animation = new WalkingAnimation();
            viewer.autoRotate = true;
            viewer.autoRotateSpeed = 0.3;
          }}
        />
      </div>

      <div className="flex flex-col gap-2">
        <SlotRow
          label={t('settings.account.skinSlotLabel')}
          thumbnail={previewSkinUrl}
          hint={variantHint}
          menu={skinMenu}
          pending={skinPending !== null}
          isSaving={skinUpload.isPending}
          onSave={saveSkin}
          onCancel={cancelSkin}
          saveLabel={t('settings.account.skinSave')}
          savingLabel={t('settings.account.skinSaving')}
          cancelLabel={t('settings.account.cancelPending')}
        />

        {provider === 'mojang' ? (
          <p className="px-1 text-xs leading-snug text-muted-foreground">
            {t('settings.account.capeManagedByMojang')}
          </p>
        ) : (
          <SlotRow
            label={t('settings.account.capeSlotLabel')}
            thumbnail={previewCapeUrl}
            menu={capeMenu}
            pending={capePending !== null}
            isSaving={capeUpload.isPending}
            onSave={saveCape}
            onCancel={cancelCape}
            saveLabel={t('settings.account.skinSave')}
            savingLabel={t('settings.account.skinSaving')}
            cancelLabel={t('settings.account.cancelPending')}
          />
        )}
      </div>
    </div>
  );
};

type SlotRowProps = {
  label: string;
  thumbnail: string;
  hint?: string | undefined;
  menu: ReactNode;
  pending: boolean;
  isSaving: boolean;
  onSave: () => Promise<void> | void;
  onCancel: () => void;
  saveLabel: string;
  savingLabel: string;
  cancelLabel: string;
};

const SlotRow = ({
  label,
  thumbnail,
  hint,
  menu,
  pending,
  isSaving,
  onSave,
  onCancel,
  saveLabel,
  savingLabel,
  cancelLabel,
}: SlotRowProps) => (
  <div className="flex items-center gap-2 rounded-md border border-border bg-card p-2">
    <img
      src={thumbnail}
      alt={label}
      width={THUMB_SIZE}
      height={THUMB_SIZE}
      className="shrink-0 rounded-sm border border-border"
      style={{ imageRendering: 'pixelated' }}
    />
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium text-foreground">{label}</span>
      {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
    </div>
    {pending ? (
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={onCancel}
          disabled={isSaving}
          aria-label={cancelLabel}
          className="size-7 p-0"
        >
          <X className="size-3.5" />
        </Button>
        <Button
          size="sm"
          onClick={() => void onSave()}
          disabled={isSaving}
          aria-label={isSaving ? savingLabel : saveLabel}
          className="size-7 p-0"
        >
          {isSaving ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Check className="size-3.5" />
          )}
        </Button>
      </div>
    ) : (
      <DropdownMenu
        trigger={
          <span className="inline-flex size-7 items-center justify-center rounded-sm bg-muted text-foreground transition-colors hover:bg-secondary">
            <Pencil className="size-3.5" />
          </span>
        }
      >
        {menu}
      </DropdownMenu>
    )}
  </div>
);
