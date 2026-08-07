// Infra-level codes on `IpcError.code`, alongside the per-domain registries in
// shared/contracts. Values are `<subsystem>/<code>` so a code read off the wire
// names the subsystem that raised it and can never alias another registry's;
// UNKNOWN is deliberately unnamespaced — it is the cross-subsystem fallback.
export const ERROR_CODES = {
  UNKNOWN: 'unknown',
  IPC_INVALID_ARGS: 'ipc/invalidArgs',
  IPC_UNTRUSTED_SENDER: 'ipc/untrustedSender',
  IPC_HANDLER_FAILED: 'ipc/handlerFailed',
  SETTINGS_INVALID_PAYLOAD: 'settings/invalidPayload',
} as const;
