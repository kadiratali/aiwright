import { expect } from '@playwright/test';
import { Given, When, Then } from './common';

Given('arama servisi ayakta', async ({ apiClient }) => {
  const res = await apiClient.get('/health');
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe('ok');
});

When('{string} araması yapılır', async ({ searchApi, searchState }, term: string) => {
  searchState.last = await searchApi.search(term);
});

Then('HTTP {int} döner', async ({ searchState }, code: number) => {
  expect(searchState.last, 'önce bir arama yapılmalı').toBeDefined();
  expect(searchState.last!.status).toBe(code);
});

Then('en az {int} ürün listelenir', async ({ searchState }, min: number) => {
  expect(searchState.last!.body.items.length).toBeGreaterThanOrEqual(min);
});

Then('hiç ürün listelenmez', async ({ searchState }) => {
  expect(searchState.last!.body.total).toBe(0);
  expect(searchState.last!.body.items).toHaveLength(0);
});

Then('her ürün id, name ve price alanlarını içerir', async ({ searchState }) => {
  for (const item of searchState.last!.body.items) {
    expect(item.id, 'id boş olmamalı').toBeTruthy();
    expect(typeof item.name).toBe('string');
    expect(typeof item.price).toBe('number');
  }
});

Then('sonuçlardan en az biri {string} terimini içerir', async ({ searchState }, term: string) => {
  const needle = term.toLocaleLowerCase('tr');
  const hit = searchState.last!.body.items.some(
    (i) => i.name.toLocaleLowerCase('tr').includes(needle) || (i.category ?? '').toLocaleLowerCase('tr').includes(needle)
  );
  expect(hit, `hiçbir sonuç "${term}" terimini içermiyor`).toBe(true);
});
