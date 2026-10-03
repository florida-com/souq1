require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET;
const OWNER_PASSWORD = process.env.OWNER_PASSWORD;
const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET || !OWNER_PASSWORD || !DATABASE_URL) {
  console.error('Missing DATABASE_URL, JWT_SECRET, or OWNER_PASSWORD in .env');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',').map(x => x.trim()) : true }));
app.use(express.json({ limit: '2mb' }));

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

function auth(req, res, next) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.owner = jwt.verify(token, JWT_SECRET); next(); }
  catch { return res.status(401).json({ error: 'Session expired' }); }
}

function cleanProducts(input) {
  if (!Array.isArray(input) || input.length > 500) throw new Error('Invalid products');
  return input.map(p => ({
    id: Number(p.id), name: String(p.name || '').trim().slice(0, 200), cat: String(p.cat || '').trim().slice(0, 100),
    price: Number(p.price), old: p.old == null || p.old === '' ? null : Number(p.old), icon: String(p.icon || '').slice(0, 20), bg: String(p.bg || '').slice(0, 30)
  })).filter(p => Number.isFinite(p.id) && p.name && p.cat && Number.isFinite(p.price) && p.price >= 0 && (p.old === null || (Number.isFinite(p.old) && p.old >= 0)));
}
function cleanPromos(input) {
  if (!Array.isArray(input) || input.length > 200) throw new Error('Invalid promos');
  return input.map(p => ({ code: String(p.code || '').trim().toUpperCase().slice(0, 40), rate: Number(p.rate) }))
    .filter(p => p.code && Number.isFinite(p.rate) && p.rate >= 0 && p.rate <= 1);
}

async function initDb() {
  await pool.query(`CREATE TABLE IF NOT EXISTS products (id BIGINT PRIMARY KEY,name TEXT NOT NULL,cat TEXT NOT NULL,price NUMERIC(12,2) NOT NULL CHECK (price >= 0),old NUMERIC(12,2),icon TEXT,bg TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY,rate NUMERIC(5,4) NOT NULL CHECK (rate >= 0 AND rate <= 1),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE TABLE IF NOT EXISTS orders (id BIGSERIAL PRIMARY KEY,customer JSONB NOT NULL,items JSONB NOT NULL,subtotal NUMERIC(12,2) NOT NULL,discount NUMERIC(12,2) NOT NULL DEFAULT 0,total NUMERIC(12,2) NOT NULL,promo TEXT,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW());
  CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);`);

  const count = await pool.query('SELECT COUNT(*)::int AS n FROM products');
  if (count.rows[0].n === 0) {
    const defaults = [
      [1,'جاكيت جلد كلاسيك','أزياء',349,null,'🧥','#6B2140'],[2,'فستان صيفي منقوش','أزياء',219,279,'👗','#E4572E'],[3,'سماعات لاسلكية برو','إلكترونيات',459,null,'🎧','#0F2E2B'],[4,'ساعة ذكية اسبورت','إلكترونيات',599,699,'⌚','#17423D'],[5,'طقم فناجين قهوة عربية','منزل',189,null,'☕','#C9A227'],[6,'مصباح طاولة نحاسي','منزل',149,null,'💡','#6B2140'],[7,'عطر ود مسك فاخر','جمال',275,329,'🧴','#0F2E2B'],[8,'طقم عناية بالبشرة','جمال',159,null,'🧖','#E4572E'],[9,'حذاء جري احترافي','رياضة',329,null,'👟','#17423D'],[10,'سجادة يوغا فاخرة','رياضة',99,129,'🧘','#C9A227'],[11,'حقيبة يد جلد طبيعي','إكسسوارات',389,null,'👜','#6B2140'],[12,'نظارة شمسية كلاسيك','إكسسوارات',249,299,'🕶️','#0F2E2B']
    ];
    for (const p of defaults) await pool.query('INSERT INTO products(id,name,cat,price,old,icon,bg) VALUES($1,$2,$3,$4,$5,$6,$7)', p);
  }
  const pc = await pool.query('SELECT COUNT(*)::int AS n FROM promos');
  if (pc.rows[0].n === 0) await pool.query("INSERT INTO promos(code,rate) VALUES ('SOUQ10',0.10),('SOUQ20',0.20)");
}

app.get('/health', async (_req, res) => { try { await pool.query('SELECT 1'); res.json({ ok: true }); } catch { res.status(503).json({ ok: false }); } });

app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const password = String(req.body?.password || '');
  const valid = await bcrypt.compare(password, await bcrypt.hash(OWNER_PASSWORD, 10));
  if (!valid) return res.status(401).json({ error: 'كلمة مرور المالك غير صحيحة' });
  const token = jwt.sign({ role: 'owner' }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token });
});

app.get('/api/store', async (_req, res) => {
  const [p, c] = await Promise.all([pool.query('SELECT id,name,cat,price,old,icon,bg FROM products ORDER BY id'), pool.query('SELECT code,rate FROM promos ORDER BY code')]);
  res.json({ products: p.rows.map(x => ({...x, id:Number(x.id), price:Number(x.price), old:x.old == null ? null : Number(x.old)})), promos: c.rows.map(x => ({...x, rate:Number(x.rate)})) });
});

app.put('/api/store', auth, async (req, res) => {
  try {
    const products = cleanProducts(req.body.products); const promos = cleanPromos(req.body.promos);
    await pool.query('BEGIN');
    await pool.query('DELETE FROM products');
    for (const p of products) await pool.query('INSERT INTO products(id,name,cat,price,old,icon,bg) VALUES($1,$2,$3,$4,$5,$6,$7)', [p.id,p.name,p.cat,p.price,p.old,p.icon,p.bg]);
    await pool.query('DELETE FROM promos');
    for (const p of promos) await pool.query('INSERT INTO promos(code,rate) VALUES($1,$2)', [p.code,p.rate]);
    await pool.query('COMMIT');
    res.json({ ok: true });
  } catch (e) { await pool.query('ROLLBACK').catch(()=>{}); res.status(400).json({ error: e.message }); }
});

app.post('/api/orders', orderLimiter, async (req, res) => {
  const o = req.body || {};
  const name = String(o.name || '').trim().slice(0,120), phone = String(o.phone || '').trim().slice(0,40), location = String(o.location || '').trim().slice(0,500);
  const items = Array.isArray(o.items) ? o.items.slice(0,100) : [];
  const subtotal = Number(o.subtotal), discount = Number(o.discount || 0), total = Number(o.total);
  if (!name || !phone || !location || !items.length || ![subtotal,discount,total].every(Number.isFinite)) return res.status(400).json({error:'بيانات الطلب غير مكتملة'});
  const result = await pool.query('INSERT INTO orders(customer,items,subtotal,discount,total,promo) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,created_at', [{name,phone,location}, items, subtotal, discount, total, o.promo ? String(o.promo).slice(0,40) : null]);
  res.status(201).json({ id: Number(result.rows[0].id), created_at: result.rows[0].created_at });
});

app.get('/api/admin/orders', auth, async (_req, res) => {
  const r = await pool.query('SELECT id,customer,items,subtotal,discount,total,promo,created_at FROM orders ORDER BY created_at DESC LIMIT 1000');
  res.json({ orders: r.rows.map(o => ({ id:Number(o.id), ...o.customer, items:o.items, subtotal:Number(o.subtotal), discount:Number(o.discount), total:Number(o.total), promo:o.promo, date:new Date(o.created_at).toLocaleString('ar-SA') })) });
});

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb().then(() => app.listen(PORT, () => console.log(`Souq Luxury Store running on port ${PORT}`))).catch(err => { console.error(err); process.exit(1); });
