/**
 * PII / sensitive-data redaction.
 *
 * EVERY text that goes to the LLM (Claude API) passes through here first. Two layers:
 *   1) Pattern-based: formats like national ID, credit card, IBAN, email, phone
 *   2) Value-based (denylist): real values under fixtures/sensitive/ are masked
 *      verbatim (even when they don't match a pattern).
 *
 * Bias: over-redact rather than under-redact. Leaking sensitive data is far worse
 * than masking an extra digit sequence in an error message.
 */

const secretValues = new Set<string>();

/** Adds known secret values to the denylist (those with >= 4 characters). */
export function registerSecrets(values: Iterable<string>): void {
  for (const v of values) {
    if (typeof v === 'string' && v.trim().length >= 4) {
      secretValues.add(v.trim());
    }
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface Pattern {
  name: string;
  re: RegExp;
}

const PATTERNS: Pattern[] = [
  { name: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.-]+/gi },
  { name: 'IBAN', re: /\bTR\d{2}[\d\s]{20,30}\b/gi },
  { name: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g },
  { name: 'TCKN', re: /\b\d{11}\b/g },
  { name: 'PHONE', re: /\b(?:\+?90|0)?5\d{9}\b/g }
];

/** Redacts a single string. */
export function redact(input: string): string {
  let out = input;

  // First the verbatim secret values (most specific)
  for (const secret of secretValues) {
    out = out.split(secret).join('[REDACTED]');
  }

  // Then the patterns
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }

  return out;
}

/** Recursively redacts all strings inside an object/array. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') {
    return redact(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}

/** Recursively collects all string values in an object (to feed the denylist). */
export function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    acc.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, acc);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectStrings(v, acc);
  }
  return acc;
}
