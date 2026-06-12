import { Page } from '@playwright/test';
import { BasePage } from './BasePage';

export class ProductsPage extends BasePage {
  readonly title = this.page.locator('.title');
  readonly inventoryList = this.page.locator('.inventory_list');

  constructor(page: Page) {
    super(page);
  }
}
