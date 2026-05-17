import { IPC_EVENTS } from '@shared/ipc';
import { useEffect } from 'react';
import { useUpdaterStore } from './store';

// Mount once at app root: subscribes to updater.status pushes and feeds the
// global store. AppBar badge + LauncherSection both read from the store.
export const UpdaterEventsListener = (): null => {
  useEffect(() => {
    const setStatus = useUpdaterStore.getState().setValue;
    return window.api.on(IPC_EVENTS.updaterStatus, setStatus);
  }, []);
  return null;
};
