import path from 'node:path';
import { app } from 'electron';

const RUNTIME_DIRNAME = 'runtimes';

export const getRuntimeRoot = (): string => path.join(app.getPath('userData'), RUNTIME_DIRNAME);

export const runtimePathFor = (component: string): string => path.join(getRuntimeRoot(), component);
