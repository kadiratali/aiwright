import { expect } from '@playwright/test';
import { When, Then } from './common';

When('the user adds the {string} product to the cart', async ({ productsPage }, productName: string) => {
  await productsPage.addProductToCart(productName);
});

When('the user removes the {string} product from the cart', async ({ productsPage }, productName: string) => {
  await productsPage.removeProductFromCart(productName);
});

Then('the cart badge should show {string}', async ({ productsPage }, count: string) => {
  await expect(productsPage.cartBadge).toHaveText(count);
});

Then('the cart badge should not be visible', async ({ productsPage }) => {
  await expect(productsPage.cartBadge).toHaveCount(0);
});

Then('the {string} product should show a {string} button', async ({ productsPage }, productName: string, label: string) => {
  if (label.toLowerCase() === 'remove') {
    await expect(productsPage.removeButton(productName)).toBeVisible();
  } else {
    await expect(productsPage.addToCartButton(productName)).toBeVisible();
  }
});

Then('the {string} product should show an {string} button', async ({ productsPage }, productName: string, label: string) => {
  if (label.toLowerCase() === 'remove') {
    await expect(productsPage.removeButton(productName)).toBeVisible();
  } else {
    await expect(productsPage.addToCartButton(productName)).toBeVisible();
  }
});
