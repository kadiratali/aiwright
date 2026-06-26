import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * API analogue of BasePage: a thin wrapper over Playwright's APIRequestContext that the
 * per-resource clients (SearchApi, ...) extend. Keeps auth/baseURL/header concerns in the
 * fixture and leaves clients to express *what* they call, not *how* the transport works.
 */
export abstract class BaseApiClient {
  constructor(protected readonly ctx: APIRequestContext) {}

  protected get(path: string, params?: Record<string, string | number | boolean>): Promise<APIResponse> {
    return this.ctx.get(path, params ? { params } : undefined);
  }

  protected post(path: string, data?: unknown): Promise<APIResponse> {
    return this.ctx.post(path, data === undefined ? undefined : { data });
  }
}
