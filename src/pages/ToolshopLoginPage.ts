import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { ToolshopLoginSelectors as S } from './selectors/toolshop.selectors';
import { TARGET_URL as SITE } from '../config';

export class ToolshopLoginPage extends BasePage {
  readonly emailInput = this.page.locator(S.email);
  readonly passwordInput = this.page.locator(S.password);
  readonly submitButton = this.page.locator(S.submit);
  readonly errorMessage = this.page.locator(S.error);
  readonly navMenu = this.page.locator(S.navMenu);

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.page.goto(`${SITE}/auth/login`);
  }

  async login(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
