export interface Product {
  id: string;
  name: string;
  price: number;
  slug: string;
}

export function validateProduct(body: unknown): string[] {
  const problems: string[] = [];
  if (typeof body !== 'object' || body === null) {
    return ['body is not an object'];
  }
  const b = body as Record<string, unknown>;
  if (typeof b.id !== 'string' || b.id.trim() === '') problems.push('id must be a non-empty string');
  if (typeof b.name !== 'string' || b.name.trim() === '') problems.push('name must be a non-empty string');
  if (typeof b.price !== 'number' || b.price < 0) problems.push('price must be a non-negative number');
  if (typeof b.slug !== 'string' || b.slug.trim() === '') problems.push('slug must be a non-empty string');
  return problems;
}
