import { expect } from '@playwright/test';
import { Then } from './common';

// NOTE: The following steps are intentionally NOT redefined here because they
// already exist in the project and are reused by the feature:
//   - "the user is on the login page"
//   - "the user logs in as the \"standard\" user"
//   - "the products page should be displayed"
//   - "the cart badge should not be visible"
//
// Only the exact-heading assertion below is new. It reuses the existing
// ProductsPage.title locator (.title) and asserts the wording exactly.
Then('the products page heading should read {string}', async ({ productsPage }, heading: string) => {
  await expect(productsPage.title).toHaveText(heading);
});
