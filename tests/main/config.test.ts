import { configWarnings } from '@main/config';
import { describe, expect, it } from 'vitest';

// CON-03: API_URL and NETWORK_API_URL address one unified backend. The session
// bearer is minted by API_URL and only that origin accepts it, so a divergence
// 401s every in-game network call with no other symptom.
describe('configWarnings', () => {
  it('is silent when both URLs share an origin', () => {
    expect(
      configWarnings({
        apiUrl: 'https://api.loontail.test',
        networkServiceUrl: 'https://api.loontail.test',
      }),
    ).toEqual([]);
  });

  it('accepts a differing path on the same origin', () => {
    expect(
      configWarnings({
        apiUrl: 'https://api.loontail.test',
        networkServiceUrl: 'https://api.loontail.test/network',
      }),
    ).toEqual([]);
  });

  it('is silent when in-game networking is switched off', () => {
    expect(
      configWarnings({ apiUrl: 'https://api.loontail.test', networkServiceUrl: undefined }),
    ).toEqual([]);
  });

  it('warns when the network origin differs from the API origin', () => {
    const warnings = configWarnings({
      apiUrl: 'https://api.loontail.test',
      networkServiceUrl: 'https://network.loontail.test',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('https://network.loontail.test');
    expect(warnings[0]).toContain('https://api.loontail.test');
    expect(warnings[0]).toContain('401');
  });

  it('warns when a port or scheme diverges', () => {
    expect(
      configWarnings({
        apiUrl: 'http://localhost:8080',
        networkServiceUrl: 'http://localhost:9090',
      }),
    ).toHaveLength(1);
    expect(
      configWarnings({
        apiUrl: 'https://api.loontail.test',
        networkServiceUrl: 'http://api.loontail.test',
      }),
    ).toHaveLength(1);
  });

  it('warns when NETWORK_API_URL is not a URL at all', () => {
    const warnings = configWarnings({
      apiUrl: 'https://api.loontail.test',
      networkServiceUrl: 'api.loontail.test',
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('not a valid URL');
  });
});
