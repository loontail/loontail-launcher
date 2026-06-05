import defaultCape from '@renderer/assets/default-cape.png';
import defaultSkin from '@renderer/assets/default-skin.png';
import { useCurrentUser } from '@renderer/features/auth';
import { toCachedMediaUrl } from '@renderer/shared/lib/mediaUrl';
import { toast } from '@renderer/shared/ui/Toast';
import { QUERY_KEYS } from '@shared/constants';
import type { Account } from '@shared/contracts/account';
import { SkinErrorCodes, type SkinKind, SkinKinds } from '@shared/contracts/skin';
import { type IpcError, isIpcError } from '@shared/ipc';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type ChangeEvent, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { clearSkin, uploadSkin } from './api';
import { localizeSkinError } from './errorCopy';
import { normalizeTextureToPng } from './texture';
import { usePendingTexture } from './usePendingTexture';
import { validateTexture } from './validateTexture';

export type UploadSkinInput = {
  type: SkinKind;
  buffer: ArrayBuffer;
};

export const useUploadSkin = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    // saveAll surfaces a localized per-texture toast; skip the generic global one.
    meta: { skipGlobalErrorToast: true },
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    // onError localizes by skin error code; skip the generic global toast.
    meta: { skipGlobalErrorToast: true },
    mutationFn: clearSkin,
    onSuccess: () => {
      queryClient.setQueryData<Account | null>(QUERY_KEYS.auth.me, (previous) =>
        previous ? { ...previous, skin: null, cape: null } : previous,
      );
    },
    onError: (error: unknown) => {
      if (isIpcError(error)) {
        toast.error(localizeSkinError(error.code, error.message, t));
      }
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useSkinEditor = () => {
  const { t } = useTranslation();
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
    const jobs = [
      { type: SkinKinds.SKIN, pending: skinPending, label: t('settings.account.skinLabel') },
      { type: SkinKinds.CAPE, pending: capePending, label: t('settings.account.capeLabel') },
    ].filter((job) => job.pending.objectUrl !== null);

    const uploadOne = async (job: (typeof jobs)[number]): Promise<void> => {
      const objectUrl = job.pending.objectUrl;
      if (objectUrl === null) return;
      const buffer = await normalizeTextureToPng(objectUrl);
      // Fast-fail on bad dimensions/corruption before the IPC round-trip; the
      // rejection handler localizes via the same SkinErrorCode path as the
      // authoritative main-side check.
      const reason = validateTexture(buffer, job.type);
      if (reason !== null) {
        const error: IpcError = { code: SkinErrorCodes.INVALID_IMAGE, message: reason };
        throw error;
      }
      await upload.mutate({ type: job.type, buffer });
      job.pending.clearIfCurrent(objectUrl);
    };

    // Upload independently so one texture failing leaves the other saved and
    // its own pending preview intact for a retry.
    const results = await Promise.allSettled(jobs.map(uploadOne));
    results.forEach((result, index) => {
      if (result.status !== 'rejected') return;
      const label = jobs[index]?.label;
      const reason: unknown = result.reason;
      if (isIpcError(reason)) {
        toast.error(localizeSkinError(reason.code, reason.message, t));
        return;
      }
      toast.error(t('settings.account.uploadFailedToast', { texture: label }));
    });
  }, [skinPending, capePending, upload, t]);

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
