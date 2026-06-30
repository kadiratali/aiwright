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
app.use(express.urlencoded({ extended: false }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ---- A tiny login + protected page, so the auth flow (login -> storageState ->
// authenticated inspect/run) has a deterministic target to verify against. -----
const DEMO_USER = process.env.DEMO_USER ?? 'user@test.com';
const DEMO_PASS = process.env.DEMO_PASS ?? 'secret123';
const loggedIn = (req: express.Request) => (req.headers.cookie ?? '').includes('nq_auth=1');

app.get('/login', (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><title>Sign in</title></head><body>
    <h1>Sign in</h1>
    <form method="post" action="/login">
      <input type="email" name="email" placeholder="Email" data-test-id="login-email" />
      <input type="password" name="password" placeholder="Password" data-test-id="login-password" />
      <button type="submit" data-test-id="login-submit">Log in</button>
    </form></body></html>`);
});

app.post('/login', (req, res) => {
  if (req.body?.email === DEMO_USER && req.body?.password === DEMO_PASS) {
    res.setHeader('Set-Cookie', 'nq_auth=1; Path=/; HttpOnly');
    res.redirect('/dashboard');
  } else {
    res.status(401).type('html').send('<h1>Invalid credentials</h1><a href="/login">Back</a>');
  }
});

const DASHBOARD_HTML = `<!doctype html><html><head><title>Dashboard</title></head><body>
  <h1 data-test-id="dashboard-title">Welcome back</h1>
  <button data-test-id="new-order">New order</button>
  <a href="/dashboard/orders" data-test-id="orders-link">My orders</a>
  </body></html>`;

// App root behaves like a real app: logged in -> the dashboard; otherwise -> login.
app.get('/', (req, res) => {
  if (loggedIn(req)) res.type('html').send(DASHBOARD_HTML);
  else res.redirect('/login');
});

app.get('/dashboard', (req, res) => {
  if (!loggedIn(req)) {
    res.redirect('/login');
    return;
  }
  res.type('html').send(DASHBOARD_HTML);
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

app.get('/api/categories', (_req, res) => {
  const counts = new Map<string, number>();
  for (const p of CATALOG) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const categories = [...counts.entries()].map(([slug, count]) => ({
    slug,
    name: slug.charAt(0).toLocaleUpperCase('tr') + slug.slice(1),
    count
  }));
  res.json({ total: categories.length, categories });
});

app.listen(PORT, () => {
  console.log(`Mock search API listening on http://localhost:${PORT}`);
});
