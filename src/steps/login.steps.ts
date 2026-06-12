import { expect } from '@playwright/test';
import { Given, When, Then } from './common';
import { getUser } from '../fixtures/data';

Given('the user is on the login page', async ({ loginPage }) => {
  await loginPage.open();
});

When(
  'the user logs in with username {string} and password {string}',
  async ({ loginPage }, username: string, password: string) => {
    await loginPage.login(username, password);
  }
);

When('the user logs in as the {string} user', async ({ loginPage }, userKey: string) => {
  const user = getUser(userKey);
  await loginPage.login(user.username, user.password);
});

Then('the products page should be displayed', async ({ productsPage }) => {
  await expect(productsPage.title).toHaveText('Products');
  await expect(productsPage.inventoryList).toBeVisible();
});

Then(
  'an error message containing {string} should be displayed',
  async ({ loginPage }, text: string) => {
    await expect(loginPage.errorMessage).toContainText(text);
  }
);
