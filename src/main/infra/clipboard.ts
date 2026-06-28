import { clipboard } from 'electron';

// Write via the native module, not `navigator.clipboard`: the renderer denies
// `clipboard-write`, so going through main bypasses Chromium's permission gating.
export const writeClipboardText = (text: string): void => {
  clipboard.writeText(text);
};
