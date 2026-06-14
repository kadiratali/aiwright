import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { ProductSelectors as S } from './selectors/products.selectors';

export class ProductsPage extends BasePage {
  readonly title = this.page.locator(S.title);
  readonly inventoryList = this.page.locator(S.inventoryList);
  readonly cartBadge: Locator = this.page.locator(S.cartBadge);

  constructor(page: Page) {
    super(page);
  }

  async open() {
    await this.goto('/inventory.html');
  }

  addToCartButton(productName: string): Locator {
    return this.page.locator(S.addToCartButton(productName));
  }

  removeButton(productName: string): Locator {
    return this.page.locator(S.removeButton(productName));
  }

  async addProductToCart(productName: string) {
    await this.addToCartButton(productName).click();
  }

  async removeProductFromCart(productName: string) {
    await this.removeButton(productName).click();
  }
}
