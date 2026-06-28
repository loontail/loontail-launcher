import { mainConfig } from '@main/config';
import { session } from 'electron';

const apiOrigin = new URL(mainConfig.apiUrl).origin;

const baseDirectives = [
  "default-src 'self'",
  // style-src 'unsafe-inline' is a documented react-aria-components requirement.
  "style-src 'self' 'unsafe-inline'",
  // No open `https`: remote images route through the host-pinned `cache:` proxy
  // so a renderer foothold can't use an image URL as an exfil beacon to an
  // arbitrary host. `blob:` is required for skinview3d's unsaved-skin preview
  // (URL.createObjectURL); the API origin is allowed for images served directly.
  `img-src 'self' data: blob: cache: ${apiOrigin}`,
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
];

const PROD_CSP = ["script-src 'self'", ...baseDirectives].join('; ');

// Dev only: Vite's HMR client + sourcemaps need eval.
const DEV_CSP = [
  "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
  ...baseDirectives.map((directive) =>
    directive.startsWith('connect-src ')
      ? `connect-src 'self' ${apiOrigin} ws: http: https:`
      : directive,
  ),
].join('; ');

const isDevRenderer = (): boolean => process.env.ELECTRON_RENDERER_URL !== undefined;

export const configureSessionSecurity = (): void => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  session.defaultSession.setPermissionCheckHandler(() => false);

  const csp = isDevRenderer() ? DEV_CSP : PROD_CSP;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
};
