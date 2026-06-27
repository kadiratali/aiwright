/**
 * Contract for GET /api/categories (operationId: listCategories)
 */
export interface Category {
  slug: string;
  name: string;
  count: number;
}

export interface CategoriesResponse {
  categories: Category[];
  /** Optional: some implementations include a top-level total */
  total?: number;
}

export function validateCategoriesResponse(body: unknown): string[] {
  const problems: string[] = [];
  if (typeof body !== 'object' || body === null) {
    return ['body is not an object'];
  }
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b['categories'])) {
    problems.push('categories is not an array');
    return problems;
  }
  (b['categories'] as unknown[]).forEach((item, i) => {
    if (typeof item !== 'object' || item === null) {
      problems.push(`categories[${i}] is not an object`);
      return;
    }
    const cat = item as Record<string, unknown>;
    if (typeof cat['slug'] !== 'string') problems.push(`categories[${i}].slug is not a string`);
    if (typeof cat['name'] !== 'string') problems.push(`categories[${i}].name is not a string`);
    if (typeof cat['count'] !== 'number') problems.push(`categories[${i}].count is not a number`);
    else if (!Number.isInteger(cat['count']) || (cat['count'] as number) <= 0)
      problems.push(`categories[${i}].count must be a positive integer, got ${cat['count']}`);
  });
  if ('total' in b && typeof b['total'] !== 'number') {
    problems.push('total is present but not a number');
  }
  return problems;
}
