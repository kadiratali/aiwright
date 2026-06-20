import { expect } from '@playwright/test';
import { Given, When, Then } from './common';
import { getUser } from '../fixtures/data';

Given('the user is on the login page', async ({ loginPage }) => {
  await loginPage.open();
});

When('the user logs in as the {string} user', async ({ loginPage }, userKey: string) => {
  const user = getUser(userKey);
  await loginPage.login(user.username, user.password);
});

When(
  'the user logs in with email {string} and password {string}',
  async ({ loginPage }, email: string, password: string) => {
    await loginPage.login(email, password);
  }
);

Then('the account menu should be displayed', async ({ loginPage }) => {
  await expect(loginPage.navMenu).toBeVisible();
});

Then('a login error should be displayed', async ({ loginPage }) => {
  await expect(loginPage.errorMessage).toBeVisible();
});
