import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import { GetmobilSearchSelectors as S } from './selectors/getmobil.selectors';

export class SearchPage extends BasePage {
  // Header search input. The hook resolves to 2 nodes (desktop + mobile header) -> .first().
  readonly searchInput: Locator = this.page.locator(S.searchInput).first();

  // Results-page product cards (one <a> per card inside the results grid).
  readonly productCards: Locator = this.page.locator(S.productCard);

  // No-results empty state — matched by its Turkish copy.
  readonly noResultsMessage: Locator = this.page.getByText(new RegExp(S.noResultsText, 'i'));

  // Results heading/breadcrumb (`"<term>" için sonuçlar`) — the site clears the search box
  // on the results page, so the submitted term is asserted against this instead.
  readonly resultsHeading: Locator = this.page.getByText(new RegExp(S.resultsHeadingText, 'i')).first();

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto('/');
    await this.page.locator(S.pageLoaded).first().waitFor({ state: 'attached', timeout: 10_000 }).catch(() => {});
  }

  async typeQuery(query: string): Promise<void> {
    await this.searchInput.fill(query);
  }

  async submitByEnter(): Promise<void> {
    await this.searchInput.press('Enter');
    // Wait for the real results navigation (/ara/?term=...), not just any URL.
    await this.page.waitForURL(S.resultsUrl, { timeout: 10_000 });
  }
}
