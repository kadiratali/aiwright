import { BaseApiClient } from '../BaseApiClient';
import { validateSearchResponse, type SearchResponse } from '../contracts/search';

export interface SearchResult {
  status: number;
  body: SearchResponse;
}

/**
 * API analogue of SearchPage. `search` performs the call AND enforces the contract: a 200 with
 * a drifted body throws here (not in a far-away assertion), so a schema regression reads as a
 * clear contract failure. Status is returned rather than asserted, so steps can check it.
 */
export class SearchApi extends BaseApiClient {
  async search(term: string): Promise<SearchResult> {
    const res = await this.get('/api/search', { term });
    const body = (await res.json()) as SearchResponse;

    if (res.status() === 200) {
      const issues = validateSearchResponse(body);
      if (issues.length) {
        throw new Error(`Contract violation on /api/search?term=${term}: ${issues.join('; ')}`);
      }
    }
    return { status: res.status(), body };
  }
}
