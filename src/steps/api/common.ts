import { createBdd } from 'playwright-bdd';
import { test } from '../../api/fixtures';

// Step bindings for the `api` project — same pattern as src/steps/common.ts, but bound to the
// browserless API `test` (apiClient/searchApi/apiState) instead of the page-object one.
export const { Given, When, Then } = createBdd(test);
