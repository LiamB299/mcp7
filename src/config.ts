import { z } from 'zod';

const envSchema = z.object({
  CIN7_ACCOUNT_ID: z.string().min(1, 'CIN7_ACCOUNT_ID is required'),
  CIN7_APPLICATION_KEY: z.string().min(1, 'CIN7_APPLICATION_KEY is required'),
  CIN7_BASE_URL: z.url().default('https://inventory.dearsystems.com/ExternalApi'),
});

export interface Config {
  accountId: string;
  applicationKey: string;
  baseUrl: string;
}

/** CIN7_BASE_URL is the API root without version (e.g. .../ExternalApi); we append `/v2/`. */
function apiBaseUrl(root: string): string {
  const trimmed = root.replace(/\/+$/, '').replace(/\/v2$/i, '');
  return `${trimmed}/v2/`;
}

/** Parse env into config. Throws an Error listing problems; never includes secret values. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  const { CIN7_ACCOUNT_ID, CIN7_APPLICATION_KEY, CIN7_BASE_URL } = parsed.data;
  return {
    accountId: CIN7_ACCOUNT_ID,
    applicationKey: CIN7_APPLICATION_KEY,
    baseUrl: apiBaseUrl(CIN7_BASE_URL),
  };
}
