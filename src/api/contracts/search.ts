import { z } from 'zod';

/**
 * Contract for /api/search (mirrors docs/api/openapi.json#SearchResponse), as Zod schemas.
 * One schema is the single source of truth for BOTH the TypeScript type (via z.infer) and the
 * runtime validation. `validateXxx` keeps returning a list of problems (empty = valid) — the
 * seam the clients and `heal-contract` already use — now with field-level messages from Zod.
 */
export const Product = z.object({
  id: z.string().min(1, 'must be a non-empty string'),
  name: z.string().min(1, 'must be a non-empty string'),
  price: z.number().nonnegative('must be a non-negative number'),
  slug: z.string().min(1, 'must be a non-empty string'),
  category: z.string().optional()
});
export type Product = z.infer<typeof Product>;

export const SearchResponse = z
  .object({
    term: z.string(),
    total: z.number().int().nonnegative(),
    items: z.array(Product)
  })
  .refine((r) => r.total === r.items.length, {
    message: 'total does not match items length',
    path: ['total']
  });
export type SearchResponse = z.infer<typeof SearchResponse>;

/** Issues as `path: message` lines (empty = valid). */
export function validateSearchResponse(body: unknown): string[] {
  const r = SearchResponse.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
