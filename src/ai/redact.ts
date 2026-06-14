/**
 * PII / hassas veri maskeleme.
 *
 * LLM'e (Claude API) giden HER metin once buradan gecirilir. Iki katman:
 *   1) Desen tabanli: TCKN, kredi karti, IBAN, e-posta, telefon gibi formatlar
 *   2) Deger tabanli (denylist): fixtures/sensitive/ altindaki gercek degerler
 *      birebir maskelenir (formata uymasa bile).
 *
 * Bias: az maskelemektense fazla maskelemek. Hassas veri sizmasi, bir hata
 * mesajinda fazladan rakam dizisinin maskelenmesinden cok daha kotudur.
 */

const secretValues = new Set<string>();

/** Bilinen gizli degerleri denylist'e ekler (>= 4 karakter olanlari). */
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

/** Tek bir metni maskeler. */
export function redact(input: string): string {
  let out = input;

  // Once birebir gizli degerler (en spesifik)
  for (const secret of secretValues) {
    out = out.split(secret).join('[REDACTED]');
  }

  // Sonra desenler
  for (const { name, re } of PATTERNS) {
    out = out.replace(re, `[REDACTED:${name}]`);
  }

  return out;
}

/** Obje/dizi icindeki tum string'leri ozyinelemeli maskeler. */
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

/** Bir objedeki tum string degerleri ozyinelemeli toplar (denylist beslemek icin). */
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
