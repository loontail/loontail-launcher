import { QUERY_KEYS } from '@shared/constants';
import { LOGIN_ERROR_CODE, type LoginErrorCode } from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelMojangLogin, fetchCurrentUser, login, logout, signInWithMojang } from './api';

const CURRENT_USER_STALE_TIME_MS = 5 * 60_000;

export const useCurrentUser = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.auth.me,
    queryFn: fetchCurrentUser,
    staleTime: CURRENT_USER_STALE_TIME_MS,
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

// Drives the OAuth Authorization Code (browser) flow as a single blocking
// call. The main process opens the system browser, waits for the loopback
// redirect, and returns the resulting account. `isPending` covers the entire
// window so the LoginForm can disable inputs and show a spinner.
export const useMojangLogin = () => {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null);
  // Track whether the user cancelled, so the inevitable abort-error doesn't
  // get rendered as a generic failure.
  const cancelledRef = useRef(false);

  // If the component unmounts mid-flow, best-effort abort so the main process
  // releases the loopback server.
  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      void cancelMojangLogin();
    };
  }, []);

  const signIn = useCallback(async (): Promise<void> => {
    setErrorCode(null);
    setIsPending(true);
    cancelledRef.current = false;
    try {
      const result = await signInWithMojang();
      if (result.ok) {
        queryClient.setQueryData(QUERY_KEYS.auth.me, result.user);
      } else if (!cancelledRef.current) {
        setErrorCode(result.error);
      }
    } catch {
      if (!cancelledRef.current) setErrorCode(LOGIN_ERROR_CODE.Unknown);
    } finally {
      setIsPending(false);
    }
  }, [queryClient]);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    void cancelMojangLogin();
  }, []);

  return { signIn, cancel, isPending, errorCode };
};
