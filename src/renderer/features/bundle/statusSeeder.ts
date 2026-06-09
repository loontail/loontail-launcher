import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import * as api from './api';

export { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
export type { StatusSeeder } from '@renderer/shared/lib/statusSeeder';

export const statusSeeder = createStatusSeeder(api.checkStatus);
