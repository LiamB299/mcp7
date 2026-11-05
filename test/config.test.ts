import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('throws listing missing vars', () => {
    expect(() => loadConfig({})).toThrow(/CIN7_ACCOUNT_ID.*\n.*CIN7_APPLICATION_KEY/);
  });

  it('applies default base url with trailing slash and does not leak secrets in errors', () => {
    const cfg = loadConfig({ CIN7_ACCOUNT_ID: 'a', CIN7_APPLICATION_KEY: 'k' });
    expect(cfg.baseUrl).toBe('https://inventory.dearsystems.com/ExternalApi/v2/');
    try {
      loadConfig({
        CIN7_ACCOUNT_ID: 'a',
        CIN7_APPLICATION_KEY: 'supersecret',
        CIN7_BASE_URL: 'nope',
      });
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecret');
    }
  });
});
