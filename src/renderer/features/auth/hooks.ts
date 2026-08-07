import { QUERY_KEYS } from '@shared/constants';
import { LOGIN_ERROR_CODE, type LoginErrorCode } from '@shared/contracts';
import { isIpcError } from '@shared/ipc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { cancelMojangLogin, fetchCurrentUser, login, logout, signInWithMojang } from './api';

const CURRENT_USER_STALE_TIME_MS = 5 * 60_000;

const LOGIN_ERROR_CODES: ReadonlySet<string> = new Set(Object.values(LOGIN_ERROR_CODE));

// Every sign-in failure arrives as a coded IpcError: main maps undici's
// `TypeError: fetch failed` to NETWORK_ERROR before it crosses the bridge
// (loontailAuth.errorToLoginCode, routes.mojangFailureCode), and the preload
// rethrows either an unwrapped IpcError or a plain Error — never a TypeError.
export const loginErrorCodeFromRejection = (error: unknown): LoginErrorCode => {
  if (isIpcError(error) && LOGIN_ERROR_CODES.has(error.code)) return error.code as LoginErrorCode;
  return LOGIN_ERROR_CODE.UNKNOWN;
};

export const useCurrentUser = () => {
  const query = useQuery({
    queryKey: QUERY_KEYS.auth.me,
    queryFn: fetchCurrentUser,
    staleTime: CURRENT_USER_STALE_TIME_MS,
  });
  return {
    user: query.data,
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
  };
};

export const useLogin = () => {
  const queryClient = useQueryClient();
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null);
  const mutation = useMutation({
    // The form renders the code inline, so the global mutation toast would
    // double-report every wrong password.
    meta: { skipGlobalErrorToast: true },
    mutationFn: login,
    onMutate: () => {
      setErrorCode(null);
    },
    onSuccess: (account) => {
      queryClient.setQueryData(QUERY_KEYS.auth.me, account);
    },
    onError: (error) => {
      setErrorCode(loginErrorCodeFromRejection(error));
    },
  });
  return {
    submit: mutation.mutateAsync,
    isPending: mutation.isPending,
    errorCode,
    clearError: () => setErrorCode(null),
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

// Drives the browser OAuth flow as one blocking call; `isPending` covers the
// whole window so the form can disable inputs and show a spinner.
export const useMojangLogin = () => {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null);

  // Unmount mid-flow: abort so main releases the loopback server.
  useEffect(() => {
    return () => {
      void cancelMojangLogin();
    };
  }, []);

  const signIn = useCallback(async (): Promise<void> => {
    setErrorCode(null);
    setIsPending(true);
    try {
      queryClient.setQueryData(QUERY_KEYS.auth.me, await signInWithMojang());
    } catch (error) {
      const code = loginErrorCodeFromRejection(error);
      // A user-cancelled browser flow is not a failure to report.
      if (code !== LOGIN_ERROR_CODE.CANCELLED) setErrorCode(code);
    } finally {
      setIsPending(false);
    }
  }, [queryClient]);

  const cancel = useCallback(() => {
    void cancelMojangLogin();
  }, []);

  const clearError = useCallback(() => setErrorCode(null), []);

  return { signIn, cancel, isPending, errorCode, clearError };
};
