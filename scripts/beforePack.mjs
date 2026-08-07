// electron-builder hook. `npm run build` fetches the authlib-injector jar via
// `prebuild`, but release CI invokes `electron-builder` directly — without this
// hook a pipeline that skipped the fetch would package `extraResources` with the
// NOTICE and no jar, and the miss would only surface when a player launches.
// The fetch script is idempotent, so this is a no-op once the jar is on disk.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const FETCH_SCRIPT = path.join(import.meta.dirname, 'fetchAuthlibInjector.mjs');
// Regenerated here, not in a package.json script, for the same reason as the
// fetch: extraResources ships THIRD-PARTY-NOTICES.md, so it must exist however
// electron-builder was invoked or the packed app would carry a stale file or none.
const NOTICES_SCRIPT = path.join(import.meta.dirname, 'generateNotices.mjs');

export default () => {
  execFileSync(process.execPath, [FETCH_SCRIPT], { stdio: 'inherit' });
  execFileSync(process.execPath, [NOTICES_SCRIPT], { stdio: 'inherit' });
};
