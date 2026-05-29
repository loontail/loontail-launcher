import { ERROR_CODES, type ErrorCode, QUERY_KEYS } from '@shared/constants';
import {
  LOGIN_ERROR_CODE,
  type LoginErrorCode,
  type LoginPayload,
  type LoginResult,
} from '@shared/contracts';
import { isIpcError } from '@shared/ipc';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cancelMojangLogin, fetchCurrentUser, login, logout, signInWithMojang } from './api';

const CURRENT_USER_STALE_TIME_MS = 5 * 60_000;

const IPC_LOGIN_ERROR_CODES: Record<ErrorCode, LoginErrorCode> = {
  [ERROR_CODES.Unknown]: LOGIN_ERROR_CODE.Unknown,
  [ERROR_CODES.IpcInvalidArgs]: LOGIN_ERROR_CODE.Unknown,
  [ERROR_CODES.IpcUntrustedSender]: LOGIN_ERROR_CODE.Unknown,
  [ERROR_CODES.IpcHandlerFailed]: LOGIN_ERROR_CODE.Unknown,
  [ERROR_CODES.AuthNetworkError]: LOGIN_ERROR_CODE.NetworkError,
  [ERROR_CODES.AuthInvalidCredentials]: LOGIN_ERROR_CODE.InvalidCredentials,
  [ERROR_CODES.SettingsInvalidPayload]: LOGIN_ERROR_CODE.Unknown,
  [ERROR_CODES.SkinUploadFailed]: LOGIN_ERROR_CODE.Unknown,
  [ERROR_CODES.SkinNotAuthenticated]: LOGIN_ERROR_CODE.Unknown,
};

export const loginErrorCodeFromRejection = (error: unknown): LoginErrorCode => {
  if (isIpcError(error)) return IPC_LOGIN_ERROR_CODES[error.code];
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
