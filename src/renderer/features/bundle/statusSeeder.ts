import { createStatusSeeder } from '@renderer/shared/lib/statusSeeder';
import * as api from './api';

export const statusSeeder = createStatusSeeder(api.checkStatus);
