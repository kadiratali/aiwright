/**
 * Selector strings for the Practice Software Testing ("Toolshop") app.
 * Verified against the live DOM via `ai:inspect`.
 */
export const ToolshopLoginSelectors = {
  email: '[data-test="email"]',
  password: '[data-test="password"]',
  submit: '[data-test="login-submit"]',
  error: '[data-test="login-error"]',
  navMenu: '[data-test="nav-menu"]'
} as const;
