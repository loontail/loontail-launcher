export const ERROR_CODES = {
  Unknown: 'UNKNOWN',
  IpcInvalidArgs: 'IPC_INVALID_ARGS',
  IpcUntrustedSender: 'IPC_UNTRUSTED_SENDER',
  IpcHandlerFailed: 'IPC_HANDLER_FAILED',
  AuthNetworkError: 'AUTH_NETWORK_ERROR',
  AuthInvalidCredentials: 'AUTH_INVALID_CREDENTIALS',
  SettingsInvalidPayload: 'SETTINGS_INVALID_PAYLOAD',
  SkinUploadFailed: 'SKIN_UPLOAD_FAILED',
  SkinNotAuthenticated: 'SKIN_NOT_AUTHENTICATED',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
