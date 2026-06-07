import { getLastPlayed } from '@main/infra/store';

export const getLastPlayedMap = (): Record<string, number> => getLastPlayed();
