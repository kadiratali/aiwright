import * as fs from 'fs';
import * as path from 'path';
import { registerSecrets, collectStrings } from '../ai/redact';

const cache = new Map<string, unknown>();
const SENSITIVE_DIR = path.join(process.cwd(), 'fixtures', 'sensitive');

/** Reads and caches the fixtures/<name>.json file. */
export function loadFixture<T>(name: string): T {
  if (!cache.has(name)) {
    const file = path.join(process.cwd(), 'fixtures', `${name}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Fixture not found: ${file}`);
    }
    cache.set(name, JSON.parse(fs.readFileSync(file, 'utf-8')));
  }
  return cache.get(name) as T;
}

export interface UserCredentials {
  username: string;
  password: string;
}

export function getUser(key: string): UserCredentials {
  const users = loadFixture<Record<string, UserCredentials>>('users');
  const user = users[key];
  if (!user) {
    throw new Error(
      `User "${key}" not found in fixtures/users.json. Available: ${Object.keys(users).join(', ')}`
    );
  }
  return user;
}

/**
 * Reads sensitive fixtures from fixtures/sensitive/<name>.json.
 * ALL string values read are automatically added to the redaction denylist,
 * so even if these values accidentally reach the LLM they become [REDACTED].
 * These files are in .gitignore and Read-denied for Claude Code.
 */
export function loadSensitive<T>(name: string): T {
  const file = path.join(SENSITIVE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Sensitive fixture not found: ${file}. Create fixtures/sensitive/${name}.json (see *.example.json).`
    );
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  registerSecrets(collectStrings(data));
  return data;
}

/**
 * Reads all real fixtures under fixtures/sensitive/ (excluding the examples)
 * and populates the denylist. Called BEFORE sending any data to the LLM in
 * separate processes such as ai:generate / ai:analyze.
 */
export function registerAllSensitive(): void {
  if (!fs.existsSync(SENSITIVE_DIR)) return;
  for (const entry of fs.readdirSync(SENSITIVE_DIR)) {
    if (!entry.endsWith('.json') || entry.endsWith('.example.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SENSITIVE_DIR, entry), 'utf-8'));
      registerSecrets(collectStrings(data));
    } catch {
      // silently skip a corrupt/unreadable file; the denylist is best-effort
    }
  }
}
