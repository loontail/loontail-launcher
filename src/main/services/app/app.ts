import { app } from 'electron';

export const getAppVersion = (): string => app.getVersion();
