declare module 'electron-squirrel-startup' {
  // Returns true when Electron was launched with a Squirrel install/update/
  // uninstall flag and has performed the corresponding shortcut work; the
  // caller should exit immediately in that case.
  const handled: boolean;
  export default handled;
}
