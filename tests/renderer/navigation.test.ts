import { useNavigationStore } from '@renderer/shared/lib/stores/navigation';
import { asCatalogKey } from '@shared/contracts/ids';
import { beforeEach, describe, expect, it } from 'vitest';

const { getState, setState } = useNavigationStore;
const top = () => {
  const { stack } = getState();
  return stack[stack.length - 1];
};
const canGoBack = () => getState().stack.length > 1;

describe('navigation store', () => {
  beforeEach(() => {
    setState({ stack: [{ name: 'home' }] });
  });

  it('starts at home', () => {
    expect(top()).toEqual({ name: 'home' });
    expect(canGoBack()).toBe(false);
  });

  it('pushes builds then a build, then pop returns to builds', () => {
    const key = asCatalogKey('official:survival');
    getState().push({ name: 'builds' });
    getState().push({ name: 'build', key });
    expect(top()).toEqual({ name: 'build', key });
    getState().pop();
    expect(top()).toEqual({ name: 'builds' });
  });

  it('treats pop at root as a no-op', () => {
    getState().pop();
    expect(top()).toEqual({ name: 'home' });
    expect(getState().stack).toHaveLength(1);
  });

  it('replaces the top route in place', () => {
    getState().push({ name: 'builds' });
    getState().replace({ name: 'settings' });
    expect(top()).toEqual({ name: 'settings' });
    expect(getState().stack).toHaveLength(2);
  });

  it('ignores pushing the identical top route', () => {
    getState().push({ name: 'builds' });
    getState().push({ name: 'builds' });
    expect(getState().stack).toHaveLength(2);
  });

  it('treats distinct build keys as different routes', () => {
    getState().push({ name: 'build', key: asCatalogKey('official:a') });
    getState().push({ name: 'build', key: asCatalogKey('official:b') });
    expect(getState().stack).toHaveLength(3);
  });

  it('reflects depth via canGoBack', () => {
    expect(canGoBack()).toBe(false);
    getState().push({ name: 'builds' });
    expect(canGoBack()).toBe(true);
    getState().reset({ name: 'home' });
    expect(canGoBack()).toBe(false);
  });
});
