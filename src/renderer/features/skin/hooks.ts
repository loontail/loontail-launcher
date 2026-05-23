import defaultCape from '@renderer/assets/default-cape.png';
import defaultSkin from '@renderer/assets/default-skin.png';
import { useCurrentUser } from '@renderer/features/auth';
import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import { QUERY_KEYS } from '@shared/constants';
import type { Account } from '@shared/contracts/account';
import type { SkinVariant } from '@shared/contracts/auth';
import { type SkinKind, SkinKinds } from '@shared/contracts/skin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearSkin, uploadSkin } from './api';

export type UploadSkinInput = {
  type: SkinKind;
  buffer: ArrayBuffer;
  variant?: SkinVariant;
};

export const useUploadSkin = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ type, buffer, variant }: UploadSkinInput) => {
      const result = await uploadSkin(type, buffer, variant);
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

type PendingFile = { file: File; objectUrl: string };

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

  const [skinPending, setSkinPending] = useState<PendingFile | null>(null);
  const [capePending, setCapePending] = useState<PendingFile | null>(null);

  const skinInputRef = useRef<HTMLInputElement>(null);
  const capeInputRef = useRef<HTMLInputElement>(null);

  // One effect per pending slot — combining them would revoke the OTHER
  // slot's blob URL whenever this one changes, leaving the viewer pointing
  // at a dangling URL (which is why the preview silently stopped working).
  useEffect(() => {
    return () => {
      if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
    };
  }, [skinPending]);

  useEffect(() => {
    return () => {
      if (capePending) URL.revokeObjectURL(capePending.objectUrl);
    };
  }, [capePending]);

  const onSkinFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
      setSkinPending({ file, objectUrl: URL.createObjectURL(file) });
    },
    [skinPending],
  );

  const onCapeFile = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (capePending) URL.revokeObjectURL(capePending.objectUrl);
      setCapePending({ file, objectUrl: URL.createObjectURL(file) });
    },
    [capePending],
  );

  const pickSkin = useCallback(() => skinInputRef.current?.click(), []);
  const pickCape = useCallback(() => capeInputRef.current?.click(), []);

  const saveAll = useCallback(async () => {
    if (skinPending) {
      const buffer = await skinPending.file.arrayBuffer();
      await upload.mutate({ type: SkinKinds.SKIN, buffer });
      URL.revokeObjectURL(skinPending.objectUrl);
      setSkinPending(null);
    }
    if (capePending) {
      const buffer = await capePending.file.arrayBuffer();
      await upload.mutate({ type: SkinKinds.CAPE, buffer });
      URL.revokeObjectURL(capePending.objectUrl);
      setCapePending(null);
    }
  }, [skinPending, capePending, upload]);

  const cancelAll = useCallback(() => {
    if (skinPending) URL.revokeObjectURL(skinPending.objectUrl);
    if (capePending) URL.revokeObjectURL(capePending.objectUrl);
    setSkinPending(null);
    setCapePending(null);
  }, [skinPending, capePending]);

  const resetAll = useCallback(async () => {
    cancelAll();
    await reset.mutate();
  }, [cancelAll, reset]);

  const previewSkinUrl = skinPending?.objectUrl ?? remoteSkin ?? defaultSkin;
  const previewCapeUrl = capePending?.objectUrl ?? remoteCape ?? defaultCape;

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
  const hasPending = skinPending !== null || capePending !== null;

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
    isSkinPending: skinPending !== null,
    isCapePending: capePending !== null,
    hasPending,
    isSaving,
    isResetting,
    isBusy,
    canReset,
    hasRemoteSkin: remoteSkin !== null,
    hasRemoteCape: remoteCape !== null,
  } as const;
};
