/**
 * Products (inventory) sayfasinin selector'lari.
 * Sabit olanlar string; urun adina gore degisenler slug ureten fonksiyon.
 */

/** "Sauce Labs Bolt T-Shirt" -> "sauce-labs-bolt-t-shirt" */
export function toSlug(productName: string): string {
  return productName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const ProductSelectors = {
  title: '.title',
  inventoryList: '.inventory_list',
  cartBadge: '.shopping_cart_badge',
  addToCartButton: (productName: string) => `[data-test="add-to-cart-${toSlug(productName)}"]`,
  removeButton: (productName: string) => `[data-test="remove-${toSlug(productName)}"]`
} as const;
