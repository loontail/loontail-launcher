import { clipboard } from 'electron';

// Write via the native clipboard module instead of `navigator.clipboard`: the
// renderer's permission handler denies `clipboard-write` by default, so going
// through main bypasses Chromium's focus / permission gating entirely.
export const writeClipboardText = (text: string): void => {
  clipboard.writeText(text);
};
