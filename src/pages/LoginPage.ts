import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { LoginSelectors as S } from './selectors/login.selectors';

export class LoginPage extends BasePage {
  readonly usernameInput = this.page.locator(S.username);
  readonly passwordInput = this.page.locator(S.password);
  readonly loginButton = this.page.locator(S.loginButton);
  readonly errorMessage = this.page.locator(S.error);

  constructor(page: Page) {
    super(page);
  }

  async open(): Promise<void> {
    await this.goto('/');
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}
