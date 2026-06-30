import { z } from 'zod';

/** Contract for GET /api/products/{id} — Zod schema is the single source of type + validation. */
export const Product = z.object({
  id: z.string().min(1, 'must be a non-empty string'),
  name: z.string().min(1, 'must be a non-empty string'),
  price: z.number().nonnegative('must be a non-negative number'),
  slug: z.string().min(1, 'must be a non-empty string')
});
export type Product = z.infer<typeof Product>;

/** Issues as `path: message` lines (empty = valid). */
export function validateProduct(body: unknown): string[] {
  const r = Product.safeParse(body);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}
