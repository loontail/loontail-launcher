import { QUERY_KEYS } from '@shared/constants';
import type { Account } from '@shared/contracts/account';
import type { SkinKind } from '@shared/contracts/skin';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { clearSkin, uploadSkin } from './api';

export const useUploadSkin = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ type, buffer }: { type: SkinKind; buffer: ArrayBuffer }) => {
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
