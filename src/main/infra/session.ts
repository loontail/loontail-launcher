import { mainConfig } from '@main/config';
import { session } from 'electron';

const apiOrigin = new URL(mainConfig.apiUrl).origin;

const baseDirectives = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https: cache:",
  "font-src 'self' data:",
  `connect-src 'self' ${apiOrigin}`,
];

const PROD_CSP = ["script-src 'self'", ...baseDirectives].join('; ');

// Dev: Vite injects HMR client + sourcemaps; needs eval. Connect to localhost dev
// server is granted via the renderer origin already (script-src 'self' covers it).
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
