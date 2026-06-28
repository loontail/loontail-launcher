declare module 'electron-squirrel-startup' {
  // True when launched with a Squirrel install/update/uninstall flag and the
  // shortcut work was done; the caller should exit immediately.
  const handled: boolean;
  export default handled;
}
