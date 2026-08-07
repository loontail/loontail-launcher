import { SkinKinds } from '@shared/contracts/skin';
import { afterEach, describe, expect, it, vi } from 'vitest';

const validatePngBufferMock = vi.hoisted(() => vi.fn());

vi.mock('@shared/yggdrasil/png', () => ({
  validatePngBuffer: validatePngBufferMock,
}));

import { validateTexture } from '@renderer/features/skin/validateTexture';

afterEach(() => {
  vi.clearAllMocks();
});

describe('validateTexture', () => {
  it('returns null and passes the kind through when the PNG is valid', () => {
    validatePngBufferMock.mockReturnValue({ ok: true, width: 64, height: 64 });
    const buffer = new ArrayBuffer(8);

    expect(validateTexture(buffer, SkinKinds.SKIN)).toBeNull();
    expect(validatePngBufferMock).toHaveBeenCalledWith(buffer, SkinKinds.SKIN);
  });

  it('returns the failure reason when the PNG is rejected', () => {
    validatePngBufferMock.mockReturnValue({ ok: false, reason: 'unexpected dimensions' });

    expect(validateTexture(new ArrayBuffer(8), SkinKinds.CAPE)).toBe('unexpected dimensions');
  });
});
