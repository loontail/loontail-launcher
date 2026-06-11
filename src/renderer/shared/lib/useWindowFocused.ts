import { useEffect, useState } from 'react';

// True while the app window holds OS focus. Drives dimming the chrome (title bar /
// top nav) when the launcher sits backgrounded behind the running game.
export const useWindowFocused = (): boolean => {
  const [focused, setFocused] = useState(() => document.hasFocus());

  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  return focused;
};
