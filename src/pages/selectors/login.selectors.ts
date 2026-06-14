/**
 * Login sayfasinin selector string'leri.
 * Selector degisince locator kullanimina dokunmadan tek yerden guncellenir.
 */
export const LoginSelectors = {
  username: '#user-name',
  password: '#password',
  loginButton: '#login-button',
  error: '[data-test="error"]'
} as const;
