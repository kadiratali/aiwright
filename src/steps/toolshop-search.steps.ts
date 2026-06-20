import { expect } from '@playwright/test';
import { Given, When, Then } from './common';

Given('the user is on the products page', async ({ productsPage }) => {
  await productsPage.open();
});

When('the user searches for {string}', async ({ productsPage }, term: string) => {
  await productsPage.search(term);
});

Then('at least one product is shown', async ({ productsPage }) => {
  await expect(productsPage.productNames.first()).toBeVisible();
});

Then('the results include {string}', async ({ productsPage }, name: string) => {
  // Toolshop search matches names AND descriptions, so we assert the expected product
  // is present rather than that every result's name contains the term.
  await expect(productsPage.productNames.filter({ hasText: name }).first()).toBeVisible();
});

Then('no products are shown', async ({ productsPage }) => {
  await expect(productsPage.productNames).toHaveCount(0);
});
