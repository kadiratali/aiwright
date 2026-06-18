/**
 * Selector strings for the login page.
 * When a selector changes, update it in one place without touching locator usage.
 */
export const LoginSelectors = {
  username: '#user-name',
  password: '#password',
  loginButton: '#login-button',
  error: '[data-test="error"]'
} as const;
