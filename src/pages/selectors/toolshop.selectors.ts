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

export const ToolshopProductSelectors = {
  searchQuery: '[data-test="search-query"]',
  searchSubmit: '[data-test="search-submit"]',
  searchReset: '[data-test="search-reset"]',
  productName: '[data-test="product-name"]'
} as const;
