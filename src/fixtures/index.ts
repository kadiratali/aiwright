import { test as base } from 'playwright-bdd';
import { SearchPage } from '../pages/SearchPage';

// Page-object fixtures are wired here as they are generated (e.g. by ai:generate).
// Add `fooPage: async ({ page }, use) => use(new FooPage(page))` per page object.
type PageFixtures = {
  searchPage: SearchPage;
};

export const test = base.extend<PageFixtures>({
  searchPage: async ({ page }, use) => use(new SearchPage(page))
});
