/**
 * Redaction regression check (CI-safe, self-contained).
 * Does not depend on a real sensitive file; it feeds the denylist explicitly.
 * Run: npm run verify:redaction
 */
import { redact, registerSecrets } from '../src/ai/redact';

// Add secret values that do NOT match a pattern to the denylist (e.g. name, code)
registerSecrets(['Ahmet Yılmaz', 'ZQ9-XK42-PLM7']);

const cases: { input: string; mustMask: string[]; mustKeep?: string[] }[] = [
  { input: 'TCKN 12345678901', mustMask: ['12345678901'] },
  { input: 'email ahmet@example.com', mustMask: ['ahmet@example.com'] },
  { input: 'card 4111111111111111', mustMask: ['4111111111111111'] },
  { input: 'IBAN TR330006100519786457841326', mustMask: ['TR330006100519786457841326'] },
  { input: 'phone 05321234567', mustMask: ['05321234567'] },
  { input: 'name Ahmet Yılmaz', mustMask: ['Ahmet Yılmaz'] },
  { input: 'code ZQ9-XK42-PLM7', mustMask: ['ZQ9-XK42-PLM7'] },
  { input: '4 items, status 200', mustMask: [], mustKeep: ['4 items, status 200'] }
];

let failed = false;
for (const { input, mustMask, mustKeep } of cases) {
  const out = redact(input);
  for (const secret of mustMask) {
    if (out.includes(secret)) {
      console.error(`LEAK: "${secret}" was not redacted -> ${out}`);
      failed = true;
    }
  }
  for (const keep of mustKeep ?? []) {
    if (!out.includes(keep)) {
      console.error(`OVER-REDACTION: "${keep}" was redacted unnecessarily -> ${out}`);
      failed = true;
    }
  }
}

console.log(failed ? 'Redaction check: FAILED ❌' : 'Redaction check: PASSED ✅');
process.exit(failed ? 1 : 0);
