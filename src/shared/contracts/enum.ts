import { z } from 'zod';

export const enumFromConst = <T extends Record<string, string>>(values: T) =>
  z.enum(Object.values(values) as [T[keyof T], ...T[keyof T][]]);
