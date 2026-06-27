import { BaseApiClient } from '../BaseApiClient';
import { validateCategoriesResponse, type CategoriesResponse } from '../contracts/categories';

export class CategoriesApi extends BaseApiClient {
  /**
   * Lists all product categories.
   * GET /api/categories
   */
  async list(): Promise<{ status: number; body: CategoriesResponse }> {
    const res = await this.get('/api/categories');
    const body = (await res.json()) as CategoriesResponse;
    if (res.status() === 200) {
      const issues = validateCategoriesResponse(body);
      if (issues.length) {
        throw new Error('Contract violation on /api/categories: ' + issues.join('; '));
      }
    }
    return { status: res.status(), body };
  }
}
