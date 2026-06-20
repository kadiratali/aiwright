import { test as base } from 'playwright-bdd';
import { ToolshopLoginPage } from '../pages/ToolshopLoginPage';
import { ToolshopProductsPage } from '../pages/ToolshopProductsPage';

type PageFixtures = {
  loginPage: ToolshopLoginPage;
  productsPage: ToolshopProductsPage;
};

export const test = base.extend<PageFixtures>({
  loginPage: async ({ page }, use) => use(new ToolshopLoginPage(page)),
  productsPage: async ({ page }, use) => use(new ToolshopProductsPage(page))
});
