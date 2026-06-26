import { BaseApiClient } from '../BaseApiClient';
import { validateProduct, type Product } from '../contracts/product';

export type ProductResult = { status: number; body: Product | Record<string, unknown> };

export class ProductApi extends BaseApiClient {
  async fetch(id: string): Promise<ProductResult> {
    const res = await this.get(`/api/products/${id}`);
    const body = (await res.json()) as Product | Record<string, unknown>;
    if (res.status() === 200) {
      const issues = validateProduct(body as Product);
      if (issues.length) {
        throw new Error('Contract violation on /api/products: ' + issues.join('; '));
      }
    }
    return { status: res.status(), body };
  }
}
