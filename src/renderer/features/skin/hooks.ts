import type { Account } from '@shared/contracts/account';
import type { SkinKind } from '@shared/contracts/skin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clearSkin, uploadSkin } from './api';

const AUTH_ME_KEY = ['auth', 'me'] as const;

export const useUploadSkin = (): {
  mutate: (args: { type: SkinKind; buffer: ArrayBuffer }) => Promise<void>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ type, buffer }: { type: SkinKind; buffer: ArrayBuffer }) => {
      const result = await uploadSkin(type, buffer);
      queryClient.setQueryData<Account | null>(AUTH_ME_KEY, (prev) =>
        prev ? { ...prev, [type]: result.url } : prev,
      );
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};

export const useClearSkin = (): { mutate: () => Promise<void>; isPending: boolean } => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: clearSkin,
    onSuccess: () => {
      queryClient.setQueryData<Account | null>(AUTH_ME_KEY, (prev) =>
        prev ? { ...prev, skin: null, cape: null } : prev,
      );
    },
  });
  return { mutate: mutation.mutateAsync, isPending: mutation.isPending };
};
