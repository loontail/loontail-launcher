import { QUERY_KEYS } from '@shared/constants';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  type LoginResult,
  type RegisterPayload,
} from '@shared/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  cancelMojangLogin,
  fetchCurrentUser,
  login,
  logout,
  register,
  signInWithMojang,
} from './api';

const CURRENT_USER_STALE_TIME_MS = 5 * 60_000;

// auth.login resolves to a discriminated LoginResult instead of throwing coded
// IpcErrors, so the only rejections here are transport-level: undici surfaces a
// dropped connection as a bare TypeError.
export const loginErrorCodeFromRejection = (error: unknown): LoginErrorCode => {
  if (error instanceof TypeError) return LOGIN_ERROR_CODE.NetworkError;
  return LOGIN_ERROR_CODE.Unknown;
};

const loginWithRejectionResult = async (payload: LoginPayload): Promise<LoginResult> => {
  try {
    return await login(payload);
  } catch (error) {
    return { ok: false, error: loginErrorCodeFromRejection(error) };
  }
};

const registerWithRejectionResult = async (payload: RegisterPayload): Promise<LoginResult> => {
  try {
    return await register(payload);
  } catch (error) {
    return { ok: false, error: loginErrorCodeFromRejection(error) };
  }
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
    mutationFn: loginWithRejectionResult,
    onMutate: () => {
      setErrorCode(null);
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(QUERY_KEYS.auth.me, result.user);
      } else {
        setErrorCode(result.error);
      }
    },
  });
  return {
    submit: mutation.mutateAsync,
    isPending: mutation.isPending,
    errorCode,
    clearError: () => setErrorCode(null),
  };
};

// Sign-up against the unified auth API. On success the backend returns the same
// authenticated shape as login, so the new account is seeded straight into the
// `auth.me` cache — the user is signed in immediately.
export const useRegister = () => {
  const queryClient = useQueryClient();
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null);
  const mutation = useMutation({
    mutationFn: registerWithRejectionResult,
    onMutate: () => {
      setErrorCode(null);
    },
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData(QUERY_KEYS.auth.me, result.user);
      } else {
        setErrorCode(result.error);
      }
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

// Drives the OAuth Authorization Code (browser) flow as a single blocking
// call. The main process opens the system browser, waits for the loopback
// redirect, and returns the resulting account. `isPending` covers the entire
// window so the LoginForm can disable inputs and show a spinner.
export const useMojangLogin = () => {
  const queryClient = useQueryClient();
  const [isPending, setIsPending] = useState(false);
  const [errorCode, setErrorCode] = useState<LoginErrorCode | null>(null);

  // If the component unmounts mid-flow, best-effort abort so the main process
  // releases the loopback server.
  useEffect(() => {
    return () => {
      void cancelMojangLogin();
    };
  }, []);

  const signIn = useCallback(async (): Promise<void> => {
    setErrorCode(null);
    setIsPending(true);
    try {
      const result = await signInWithMojang();
      if (result.ok) {
        queryClient.setQueryData(QUERY_KEYS.auth.me, result.user);
      } else if (result.error !== LOGIN_ERROR_CODE.Cancelled) {
        setErrorCode(result.error);
      }
    } catch {
      setErrorCode(LOGIN_ERROR_CODE.Unknown);
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
