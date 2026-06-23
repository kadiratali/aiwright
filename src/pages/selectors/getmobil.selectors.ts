/**
 * Selector strings for getmobil.com.
 * Verified against the live DOM via `ai:inspect` — the search box + page-ready hook on the
 * home page, and the results grid + no-results copy via a search-results journey
 * (https://getmobil.com/ara/?term=...).
 */
export const GetmobilSearchSelectors = {
  // Header search box. Resolves to 2 nodes (desktop + mobile header) -> use .first().
  // Verified selector from fresh selector map: [data-test-id="selenium-header-search-input"]
  searchInput: '[data-test-id="selenium-header-search-input"]',
  // Page-ready marker — good waitFor hook before asserting.
  pageLoaded: '[data-test-id="selenium_page_loaded"]',
  // The site submits search on Enter (no submit button has a test-id) — see SearchPage.submitByEnter().
  // Results page (/ara/?term=...): grid container + per-card links.
  resultsGrid: '[data-testid="product-list-grid"]',
  productCard: 'a[data-testid^="product-grid-card-"]',
  // Results URL path — the site submits to /ara/?term=<query>; used to wait for navigation.
  resultsUrl: /\/ara\//,
  // Results heading / breadcrumb copy: `"<term>" için sonuçlar` (has-results) — the page
  // does NOT keep the typed term in the search box, so assert the term against this instead.
  resultsHeadingText: 'için sonuçlar',
  // No-results empty state has no test-id — matched by its Turkish copy:
  //   `"<term>" için sonuç bulunamadı.`
  noResultsText: 'sonuç bulunamadı'
} as const;
