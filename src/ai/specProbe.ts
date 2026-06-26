import * as fs from 'fs';
import * as path from 'path';
import { request } from '@playwright/test';
import * as dotenv from 'dotenv';

dotenv.config();

/**
 * API analogue of pageInspector. Where `inspect` extracts a stability-ranked selector map from
 * the live DOM, `probe` ingests an OpenAPI spec and (optionally) verifies each GET endpoint
 * against the live API — producing an endpoint map that grounds generation in REAL, declared
 * endpoints instead of guessed paths/shapes. Deterministic (no LLM), like inspect.
 *
 * The spec must be JSON (OpenAPI in JSON is valid Swagger) so this stays dependency-free — no
 * YAML parser is bundled. Point `specPath` at docs/api/openapi.json or any JSON OpenAPI doc.
 */
export interface EndpointParam {
  name: string;
  in: 'query' | 'path' | 'header' | 'cookie';
  required: boolean;
  type?: string;
  example?: string | number | boolean;
}

export interface EndpointResponse {
  status: string;
  description?: string;
  /** Short schema name ($ref tail, e.g. "SearchResponse" / "Product[]") or inline type. */
  schema?: string;
}

/** Result of hitting the endpoint live — the "verified" half, mirroring inspect's count check. */
export interface ObservedResult {
  url: string;
  status: number;
  /** True if the observed status is one the spec declares for this endpoint. */
  declared: boolean;
  jsonOk: boolean;
  note?: string;
}

export interface EndpointEntry {
  method: string;
  path: string;
  operationId?: string;
  summary?: string;
  params: EndpointParam[];
  responses: EndpointResponse[];
  observed?: ObservedResult;
}

export interface EndpointMap {
  source: string;
  title: string;
  version?: string;
  baseUrl: string;
  generatedAt: string;
  endpoints: EndpointEntry[];
  warnings: string[];
}

export interface ProbeOptions {
  /** Override the base URL to probe (defaults to spec servers[0] / API_BASE_URL). */
  baseUrl?: string;
  /** Actually call the GET endpoints to verify them, not just parse the spec. */
  live?: boolean;
  rootDir?: string;
}

/** Short, human-readable schema name for a response object (resolves $ref / array items). */
function schemaName(responseObj: any): string | undefined {
  const schema = responseObj?.content?.['application/json']?.schema;
  if (!schema) return undefined;
  if (schema.$ref) return schema.$ref.split('/').pop();
  if (schema.type === 'array' && schema.items?.$ref) return `${schema.items.$ref.split('/').pop()}[]`;
  return schema.type;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

export async function probeApi(specPath: string, opts: ProbeOptions = {}): Promise<EndpointMap> {
  const rootDir = opts.rootDir ?? process.cwd();
  const abs = path.isAbsolute(specPath) ? specPath : path.join(rootDir, specPath);
  if (!fs.existsSync(abs)) throw new Error(`OpenAPI spec not found: ${specPath}`);

  let spec: any;
  try {
    spec = JSON.parse(fs.readFileSync(abs, 'utf-8'));
  } catch {
    throw new Error(
      `Could not parse ${specPath} as JSON. probe needs a JSON OpenAPI spec ` +
        `(YAML is not supported without a parser) — see docs/api/openapi.json.`
    );
  }

  const warnings: string[] = [];
  const baseUrl =
    opts.baseUrl ?? spec.servers?.[0]?.url ?? process.env.API_BASE_URL ?? 'http://localhost:4010';

  const endpoints: EndpointEntry[] = [];
  for (const [p, pathItem] of Object.entries<any>(spec.paths ?? {})) {
    for (const method of Object.keys(pathItem)) {
      if (!HTTP_METHODS.includes(method)) continue;
      const op = pathItem[method];
      endpoints.push({
        method: method.toUpperCase(),
        path: p,
        operationId: op.operationId,
        summary: op.summary,
        params: (op.parameters ?? []).map((pr: any) => ({
          name: pr.name,
          in: pr.in,
          required: !!pr.required,
          type: pr.schema?.type,
          example: pr.schema?.example ?? pr.example
        })),
        responses: Object.keys(op.responses ?? {}).map((code) => ({
          status: code,
          description: op.responses[code]?.description,
          schema: schemaName(op.responses[code])
        }))
      });
    }
  }

  if (opts.live) {
    const ctx = await request.newContext({ baseURL: baseUrl });
    try {
      for (const e of endpoints) {
        if (e.method !== 'GET') continue; // only safe, idempotent calls are probed
        let url = e.path;
        const query: string[] = [];
        const missing: string[] = [];
        for (const pr of e.params) {
          if (pr.example === undefined) {
            if (pr.required) missing.push(pr.name);
            continue;
          }
          const value = encodeURIComponent(String(pr.example));
          if (pr.in === 'path') url = url.replace(`{${pr.name}}`, value);
          else if (pr.in === 'query') query.push(`${pr.name}=${value}`);
        }
        if (missing.length) {
          e.observed = { url, status: 0, declared: false, jsonOk: false, note: `skipped live: no example for required param(s) ${missing.join(', ')}` };
          continue;
        }
        const full = query.length ? `${url}?${query.join('&')}` : url;
        try {
          const res = await ctx.get(full);
          const status = res.status();
          const declared = e.responses.some((r) => r.status === String(status));
          let jsonOk = true;
          try {
            await res.json();
          } catch {
            jsonOk = false;
          }
          e.observed = {
            url: full,
            status,
            declared,
            jsonOk,
            note: declared ? undefined : `status ${status} not declared in the spec`
          };
        } catch (err: any) {
          e.observed = { url: full, status: 0, declared: false, jsonOk: false, note: `request failed: ${err?.message ?? err}` };
        }
      }
    } finally {
      await ctx.dispose();
    }
    if (endpoints.some((e) => e.observed?.status === 0 && e.observed.note?.startsWith('request failed'))) {
      warnings.push(`One or more endpoints could not be reached at ${baseUrl} — is the API/mock running?`);
    }
  }

  return {
    source: specPath,
    title: spec.info?.title ?? 'API',
    version: spec.info?.version,
    baseUrl,
    generatedAt: new Date().toISOString(),
    endpoints,
    warnings
  };
}

export function writeEndpointMap(map: EndpointMap, rootDir = process.cwd()): string {
  const slug =
    (map.title || 'api')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'api';
  const target = path.join(rootDir, 'reports', `endpoint-map-${slug}.json`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(map, null, 2));
  return target;
}
