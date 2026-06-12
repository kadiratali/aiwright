import * as fs from 'fs';
import * as path from 'path';

const cache = new Map<string, unknown>();

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
