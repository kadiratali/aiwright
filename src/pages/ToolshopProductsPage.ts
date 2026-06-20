import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { ToolshopProductSelectors as S } from './selectors/toolshop.selectors';
import { TARGET_URL as SITE } from '../config';

export class ToolshopProductsPage extends BasePage {
  readonly searchInput = this.page.locator(S.searchQuery);
  readonly searchButton = this.page.locator(S.searchSubmit);
  readonly searchReset = this.page.locator(S.searchReset);
  readonly productNames: Locator = this.page.locator(S.productName);

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.page.goto(`${SITE}/`);
  }

  async search(term: string): Promise<void> {
    await this.searchInput.fill(term);
    await this.searchButton.click();
  }

  async resetSearch(): Promise<void> {
    await this.searchReset.click();
  }
}
