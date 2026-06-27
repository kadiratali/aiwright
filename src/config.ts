/**
 * Resolved project config: the values from aiwright.config.ts with env-var overrides applied
 * (env wins, for CI flexibility). Import THIS anywhere in the pipeline instead of reading
 * process.env or hardcoding a URL — retargeting the whole suite stays a one-file change in
 * aiwright.config.ts.
 */
import userConfig, { type AiwrightConfig } from '../aiwright.config';

export const config: AiwrightConfig = {
  targetUrl: process.env.TARGET_URL ?? process.env.BASE_URL ?? userConfig.targetUrl,
  apiBaseUrl: process.env.API_BASE_URL ?? userConfig.apiBaseUrl,
  openApiSpec: process.env.OPENAPI_SPEC ?? userConfig.openApiSpec,
  testIdAttributes: userConfig.testIdAttributes
};

/** @deprecated Prefer `config.targetUrl`. Kept so existing imports keep working. */
export const TARGET_URL = config.targetUrl;
