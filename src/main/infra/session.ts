import { session } from 'electron';

const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: cache:",
  "font-src 'self' data:",
  "connect-src 'self' https:",
].join('; ');

const isDevRenderer = (): boolean => process.env.ELECTRON_RENDERER_URL !== undefined;

export const configureSessionSecurity = (): void => {
  // Deny all renderer permission requests (camera, mic, notifications, clipboard, …).
  // The launcher never asks for these; opting in would require an explicit allowlist here.
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  session.defaultSession.setPermissionCheckHandler(() => false);

  if (isDevRenderer()) return;

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [PROD_CSP],
      },
    });
  });
};
