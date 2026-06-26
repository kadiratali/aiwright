/**
 * Hand-rolled contract for /api/search (mirrors docs/api/openapi.json#SearchResponse).
 *
 * validateSearchResponse returns a list of problems instead of throwing, so the caller can
 * decide what to do. This is the seam a future `heal-contract` agent tool hooks into: when
 * the live response drifts from this shape, the issues list is exactly the diff to act on.
 * (Kept dependency-free on purpose; swap for Zod if richer validation is wanted later.)
 */
export interface Product {
  id: string;
  name: string;
  price: number;
  slug: string;
  category?: string;
}

export interface SearchResponse {
  term: string;
  total: number;
  items: Product[];
}

export function validateSearchResponse(body: unknown): string[] {
  const issues: string[] = [];
  if (typeof body !== 'object' || body === null) return ['response is not an object'];
  const r = body as Record<string, unknown>;

  if (typeof r.term !== 'string') issues.push('term must be a string');
  if (typeof r.total !== 'number') issues.push('total must be a number');
  if (!Array.isArray(r.items)) {
    issues.push('items must be an array');
    return issues;
  }
  r.items.forEach((raw, i) => {
    const it = raw as Record<string, unknown>;
    if (typeof it?.id !== 'string') issues.push(`items[${i}].id must be a string`);
    if (typeof it?.name !== 'string') issues.push(`items[${i}].name must be a string`);
    if (typeof it?.price !== 'number') issues.push(`items[${i}].price must be a number`);
    if (typeof it?.slug !== 'string') issues.push(`items[${i}].slug must be a string`);
  });
  if (typeof r.total === 'number' && Array.isArray(r.items) && r.total !== r.items.length) {
    issues.push(`total (${r.total}) does not match items length (${r.items.length})`);
  }
  return issues;
}
