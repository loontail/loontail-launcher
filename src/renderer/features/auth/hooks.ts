import { QUERY_KEYS } from '@shared/constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchCurrentUser, login, logout } from './api';

export const useCurrentUser = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.auth.me,
    queryFn: fetchCurrentUser,
    staleTime: Number.POSITIVE_INFINITY,
  });
  return { user: query.data, isPending: query.isPending };
};

export const useLogin = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(QUERY_KEYS.auth.me, result.user);
      }
    },
  });
  return {
    submit: mutation.mutateAsync,
    isPending: mutation.isPending,
  };
};

export const useLogout = () => {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEYS.auth.me });
      queryClient.setQueryData(QUERY_KEYS.auth.me, null);
    },
  });
  return { submit: mutation.mutateAsync, isPending: mutation.isPending };
};
