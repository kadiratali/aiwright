/**
 * Local mock for the (not-yet-published) getmobil search API. Implements docs/api/openapi.json
 * with deterministic data so the API suite has a stable, offline target to go green against.
 * Swap this for the real service by pointing API_BASE_URL at it — the client/steps don't change.
 *
 *   npm run mock:api            # standalone
 *   (Playwright's webServer also boots this automatically for the `api` project.)
 */
import express from 'express';

const PORT = Number(process.env.MOCK_API_PORT ?? 4010);

interface Product {
  id: string;
  name: string;
  price: number;
  slug: string;
  category: string;
}

const CATALOG: Product[] = [
  { id: 'p1', name: 'Akıllı Telefon X', price: 12999, slug: 'akilli-telefon-x', category: 'telefon' },
  { id: 'p2', name: 'Telefon Kılıfı', price: 199, slug: 'telefon-kilifi', category: 'aksesuar' },
  { id: 'p3', name: 'Kablosuz Kulaklık', price: 899, slug: 'kablosuz-kulaklik', category: 'aksesuar' },
  { id: 'p4', name: 'Dizüstü Bilgisayar', price: 24999, slug: 'dizustu-bilgisayar', category: 'bilgisayar' }
];

const trLower = (s: string) => s.toLocaleLowerCase('tr');

const app = express();

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/search', (req, res) => {
  const term = typeof req.query.term === 'string' ? req.query.term.trim() : '';
  if (!term) {
    res.status(400).json({ error: 'term is required' });
    return;
  }
  const needle = trLower(term);
  const items = CATALOG.filter(
    (p) => trLower(p.name).includes(needle) || trLower(p.category).includes(needle)
  );
  res.json({ term, total: items.length, items });
});

app.get('/api/products/:id', (req, res) => {
  const product = CATALOG.find((p) => p.id === req.params.id);
  if (!product) {
    res.status(404).json({ error: `no product with id ${req.params.id}` });
    return;
  }
  res.json(product);
});

app.listen(PORT, () => {
  console.log(`Mock search API listening on http://localhost:${PORT}`);
});
