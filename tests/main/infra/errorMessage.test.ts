import { errorMessage } from '@main/infra/errorMessage';
import { describe, expect, it } from 'vitest';

describe('errorMessage', () => {
  it('returns the message of an Error instance', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('stringifies non-error values', () => {
    expect(errorMessage('plain')).toBe('plain');
    expect(errorMessage(42)).toBe('42');
    expect(errorMessage(null)).toBe('null');
  });
});
