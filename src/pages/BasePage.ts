import { Page, Locator } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** baseURL'e gore relatif gider (playwright.config.ts -> use.baseURL). */
  async goto(path = '/'): Promise<void> {
    await this.page.goto(path);
  }

  locator(selector: string): Locator {
    return this.page.locator(selector);
  }
}
