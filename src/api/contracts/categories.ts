import { z } from 'zod';

/** Contract for GET /api/categories (operationId: listCategories) — Zod schemas. */
export const Category = z.object({
  slug: z.string().min(1, 'must be a non-empty string'),
  name: z.string().min(1, 'must be a non-empty string'),
  count: z.number().int().positive('must be a positive integer')
});
export type Category = z.infer<typeof Category>;

export const CategoriesResponse = z.object({
  categories: z.array(Category),
  /** Optional: some implementations include a top-level total. */
  total: z.number().optional()
});
export type CategoriesResponse = z.infer<typeof CategoriesResponse>;

/** Issues as `path: message` lines (empty = valid). */
export function validateCategoriesResponse(body: unknown): string[] {
  const r = CategoriesResponse.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
