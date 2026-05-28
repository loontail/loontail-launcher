import defaultCape from '@renderer/assets/default-cape.png';
import defaultSkin from '@renderer/assets/default-skin.png';
import { useCurrentUser } from '@renderer/features/auth';
import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import { QUERY_KEYS } from '@shared/constants';
import type { Account } from '@shared/contracts/account';
import { type SkinKind, SkinKinds } from '@shared/contracts/skin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useCallback, useMemo, useRef } from 'react';
import { clearSkin, uploadSkin } from './api';
import { normalizeTextureToPng } from './texture';
import { usePendingTexture } from './usePendingTexture';

export type UploadSkinInput = {
  type: SkinKind;
  buffer: ArrayBuffer;
};

export const useUploadSkin = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ type, buffer }: UploadSkinInput) => {
      const result = await uploadSkin(type, buffer);
      queryClient.setQueryData<Account | null>(QUERY_KEYS.auth.me, (previous) =>
        previous ? { ...previous, [type]: result.url } : previous,
      );
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useClearSkin = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: clearSkin,
    onSuccess: () => {
      queryClient.setQueryData<Account | null>(QUERY_KEYS.auth.me, (previous) =>
        previous ? { ...previous, skin: null, cape: null } : previous,
      );
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

/**
 * Owns the skin/cape file pickers, the unsaved-preview state, and the
 * upload/reset mutations. Returns ready-to-bind input props plus an action
 * surface so the AccountSection can lay out the viewer and the controls
 * independently.
 */
export const useSkinEditor = () => {
  const { user } = useCurrentUser();
  const provider = user?.provider ?? null;
  const upload = useUploadSkin();
  const reset = useClearSkin();

  const remoteSkin = user?.skin ? toCachedMediaUrl(user.skin) : null;
  const remoteCape = user?.cape ? toCachedMediaUrl(user.cape) : null;

  const skinPending = usePendingTexture();
  const capePending = usePendingTexture();

  const skinInputRef = useRef<HTMLInputElement>(null);
  const capeInputRef = useRef<HTMLInputElement>(null);

  const onSkinFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      skinPending.setFile(file);
    },
    [skinPending],
  );

  const onCapeFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      capePending.setFile(file);
    },
    [capePending],
  );

  const pickSkin = useCallback(() => skinInputRef.current?.click(), []);
  const pickCape = useCallback(() => capeInputRef.current?.click(), []);

  const saveAll = useCallback(async () => {
    if (skinPending.objectUrl !== null) {
      const objectUrl = skinPending.objectUrl;
      const buffer = await normalizeTextureToPng(objectUrl);
      await upload.mutate({ type: SkinKinds.SKIN, buffer });
      skinPending.clearIfCurrent(objectUrl);
    }
    if (capePending.objectUrl !== null) {
      const objectUrl = capePending.objectUrl;
      const buffer = await normalizeTextureToPng(objectUrl);
      await upload.mutate({ type: SkinKinds.CAPE, buffer });
      capePending.clearIfCurrent(objectUrl);
    }
  }, [skinPending, capePending, upload]);

  const cancelAll = useCallback(() => {
    skinPending.clear();
    capePending.clear();
  }, [skinPending, capePending]);

  const resetAll = useCallback(async () => {
    cancelAll();
    await reset.mutate();
  }, [cancelAll, reset]);

  const previewSkinUrl = skinPending.objectUrl ?? remoteSkin ?? defaultSkin;
  const previewCapeUrl = capePending.objectUrl ?? remoteCape ?? defaultCape;

  const skinInputProps = useMemo(
    () => ({
      ref: skinInputRef,
      type: 'file' as const,
      accept: '.png',
      hidden: true,
      onChange: onSkinFile,
    }),
    [onSkinFile],
  );
  const capeInputProps = useMemo(
    () => ({
      ref: capeInputRef,
      type: 'file' as const,
      accept: '.png',
      hidden: true,
      onChange: onCapeFile,
    }),
    [onCapeFile],
  );

  const isSaving = upload.isPending;
  const isResetting = reset.isPending;
  const isBusy = isSaving || isResetting;
  const hasPending = skinPending.hasPending || capePending.hasPending;

  const canReset =
    provider === 'mojang' ? remoteSkin !== null : remoteSkin !== null || remoteCape !== null;

  return {
    provider,
    skinInputProps,
    capeInputProps,
    pickSkin,
    pickCape,
    saveAll,
    cancelAll,
    resetAll,
    previewSkinUrl,
    previewCapeUrl,
    isSkinPending: skinPending.hasPending,
    isCapePending: capePending.hasPending,
    hasPending,
    isSaving,
    isResetting,
    isBusy,
    canReset,
    hasRemoteSkin: remoteSkin !== null,
    hasRemoteCape: remoteCape !== null,
  } as const;
};
