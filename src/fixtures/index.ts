import { test as base } from 'playwright-bdd';
import { ToolshopLoginPage } from '../pages/ToolshopLoginPage';

type PageFixtures = {
  loginPage: ToolshopLoginPage;
};

export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => use(new ToolshopLoginPage(page))
});
