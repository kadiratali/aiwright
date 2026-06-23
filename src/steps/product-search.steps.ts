import { expect } from '@playwright/test';
import { Given, When, Then } from './common';

Given('the visitor is on the Getmobil home page', async ({ searchPage }) => {
  await searchPage.open();
});

Given('the header search box is visible and empty', async ({ searchPage }) => {
  await expect(searchPage.searchInput).toBeVisible();
  await expect(searchPage.searchInput).toHaveValue('');
});

When('the visitor types {string} into the header search box', async ({ searchPage }, query: string) => {
  await searchPage.typeQuery(query);
});

When('the visitor submits the search', async ({ searchPage }) => {
  await searchPage.submitByEnter();
});

Then('the page URL contains the search query parameter for {string}', async ({ page }, query: string) => {
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(query).replace(/%20/g, '(\\+|%20)')));
});

Then('at least one product card is displayed in the results', async ({ searchPage }) => {
  await expect(searchPage.productCards.first()).toBeVisible();
  const count = await searchPage.productCards.count();
  expect(count).toBeGreaterThan(0);
});

Then('a product card mentioning {string} is visible in the results', async ({ searchPage }, term: string) => {
  const cards = searchPage.productCards;
  const count = await cards.count();
  let found = false;
  for (let i = 0; i < count; i++) {
    const text = await cards.nth(i).innerText();
    if (text.toLowerCase().includes(term.toLowerCase())) {
      found = true;
      break;
    }
  }
  expect(found, `Expected at least one product card to mention "${term}"`).toBe(true);
});

Then('the results page reflects the search term {string}', async ({ searchPage }, term: string) => {
  await expect(searchPage.resultsHeading).toContainText(term);
});

Then('no empty-state message is shown', async ({ searchPage }) => {
  await expect(searchPage.noResultsMessage).not.toBeVisible();
});

Then('the results page loads without a server error', async ({ page }) => {
  // A server error would land on an error route; the results URL (/ara/) is not one.
  // NOTE: do NOT substring-match "500"/"404" in the page body — product prices (e.g. ₺2.500)
  // contain those digits and cause false failures.
  expect(page.url()).not.toMatch(/\/(error|not-found|maintenance)\b|[?&](error|status)=5\d\d/i);
});

Then('the page URL correctly encodes the Turkish characters for {string}', async ({ page }, query: string) => {
  const currentUrl = page.url();
  // The URL should not contain raw unencoded Turkish characters as-is;
  // percent-encoding of at least one special character confirms encoding happened.
  const encoded = encodeURIComponent(query);
  // Accept either percent-encoded or the browser's normalised form
  const hasEncoded = currentUrl.includes(encoded) || currentUrl.includes(query);
  expect(hasEncoded, `Expected URL to reflect the search term "${query}". Actual URL: ${currentUrl}`).toBe(true);
});
