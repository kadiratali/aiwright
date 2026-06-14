import * as fs from 'fs';
import * as path from 'path';
import { registerSecrets, collectStrings } from '../ai/redact';

const cache = new Map<string, unknown>();
const SENSITIVE_DIR = path.join(process.cwd(), 'fixtures', 'sensitive');

/** fixtures/<name>.json dosyasini okur ve cache'ler. */
export function loadFixture<T>(name: string): T {
  if (!cache.has(name)) {
    const file = path.join(process.cwd(), 'fixtures', `${name}.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`Fixture bulunamadi: ${file}`);
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
      `"${key}" kullanicisi fixtures/users.json icinde yok. Mevcutlar: ${Object.keys(users).join(', ')}`
    );
  }
  return user;
}

/**
 * Hassas fixture'lari fixtures/sensitive/<name>.json'dan okur.
 * Okunan TUM string degerleri otomatik olarak maskeleme denylist'ine eklenir,
 * boylece bu degerler kazara LLM'e gitse bile [REDACTED] olur.
 * Bu dosyalar .gitignore'da ve Claude Code icin Read-deny kapsamindadir.
 */
export function loadSensitive<T>(name: string): T {
  const file = path.join(SENSITIVE_DIR, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(
      `Hassas fixture bulunamadi: ${file}. fixtures/sensitive/${name}.json olusturun (bkz. *.example.json).`
    );
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf-8')) as T;
  registerSecrets(collectStrings(data));
  return data;
}

/**
 * fixtures/sensitive/ altindaki tum gercek fixture'lari (example'lar haric)
 * okuyup denylist'i doldurur. ai:generate / ai:analyze gibi ayri proseslerde,
 * LLM'e veri gondermeden ONCE cagrilir.
 */
export function registerAllSensitive(): void {
  if (!fs.existsSync(SENSITIVE_DIR)) return;
  for (const entry of fs.readdirSync(SENSITIVE_DIR)) {
    if (!entry.endsWith('.json') || entry.endsWith('.example.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SENSITIVE_DIR, entry), 'utf-8'));
      registerSecrets(collectStrings(data));
    } catch {
      // bozuk/okunamayan dosyayi sessizce atla; denylist en iyi caba
    }
  }
}
