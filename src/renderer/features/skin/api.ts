import type { SkinVariant } from '@shared/contracts/auth';
import type { SkinKind, UploadSkinResult } from '@shared/contracts/skin';
import { IPC_CHANNELS } from '@shared/ipc';

export const uploadSkin = (
  type: SkinKind,
  buffer: ArrayBuffer,
  variant?: SkinVariant,
): Promise<UploadSkinResult> =>
  window.api.invoke(IPC_CHANNELS.mediaUploadSkin, { type, buffer, variant });

export const clearSkin = (): Promise<void> =>
  window.api.invoke(IPC_CHANNELS.mediaClearSkin, undefined);
