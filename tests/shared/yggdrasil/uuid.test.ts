import { YggdrasilError, YggdrasilErrorCodes } from '@shared/yggdrasil/errors';
import { dashUuid, isUuidUndashed, undashUuid } from '@shared/yggdrasil/uuid';
import { describe, expect, it } from 'vitest';

const UNDASHED = 'aabbccddeeff00112233445566778899';
const DASHED = 'aabbccdd-eeff-0011-2233-445566778899';

describe('uuid helpers', () => {
  it('isUuidUndashed only accepts the 32-char hex shape', () => {
    expect(isUuidUndashed(UNDASHED)).toBe(true);
    expect(isUuidUndashed(DASHED)).toBe(false);
    expect(isUuidUndashed(`${UNDASHED}00`)).toBe(false);
  });

  it('undashUuid accepts both shapes and lowercases the output', () => {
    expect(undashUuid(UNDASHED.toUpperCase())).toBe(UNDASHED);
    expect(undashUuid(DASHED.toUpperCase())).toBe(UNDASHED);
  });

  it('dashUuid accepts both shapes and lowercases the output', () => {
    expect(dashUuid(UNDASHED.toUpperCase())).toBe(DASHED);
    expect(dashUuid(DASHED.toUpperCase())).toBe(DASHED);
  });

  it('throws YggdrasilError(invalid_uuid) for invalid input', () => {
    for (const reject of [undashUuid, dashUuid]) {
      try {
        reject('not a uuid');
        expect.fail('expected throw');
      } catch (err) {
        expect(err).toBeInstanceOf(YggdrasilError);
        expect((err as YggdrasilError).code).toBe(YggdrasilErrorCodes.INVALID_UUID);
      }
    }
  });

  it('truncates an oversized value in the error message', () => {
    const huge = 'z'.repeat(500);
    expect(() => undashUuid(huge)).toThrow(/z{48}…$/);
  });
});
