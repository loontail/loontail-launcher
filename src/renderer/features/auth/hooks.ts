import type { Account, LoginPayload, LoginResult } from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCurrentUser, login, logout } from './api';

const AUTH_ME_KEY = ['auth', 'me'] as const;

export const useCurrentUser = (): {
  user: Account | null | undefined;
  isPending: boolean;
} => {
  const query = useQuery({
    queryKey: AUTH_ME_KEY,
    queryFn: fetchCurrentUser,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { user: query.data, isPending: query.isPending };
};

export const useLogin = (): {
  submit: (payload: LoginPayload) => Promise<LoginResult>;
  isPending: boolean;
} => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(AUTH_ME_KEY, result.user);
      }
    },
  });
  return {
    submit: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};

export const useLogout = (): { submit: () => Promise<void>; isPending: boolean } => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: AUTH_ME_KEY });
      queryClient.setQueryData(AUTH_ME_KEY, null);
    },
  });
  return { submit: mutation.mutateAsync, isPending: mutation.isPending };
};
