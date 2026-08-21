// server.js — TradeSim backend
//
// Routes:
//   POST /api/register          { username, password }
//   POST /api/login             { username, password }
//   GET  /api/market/prices                              (public, live prices)
//   GET  /api/market/history/:symbol                      (public, sparkline data)
//   GET  /api/portfolio          (auth)                   cash + holdings + live value
//   POST /api/trade              (auth)  { symbol, side, quantity }
//   GET  /api/history            (auth)                   past trades
//
// Real market data comes from CoinCap's free public API — no key required,
// and much more tolerant of shared-hosting IPs than CoinGecko's free tier.

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Supported assets --------------------------------------------------
// CoinCap asset ids (lowercase slugs)
const ASSETS = {
  BTC: { id: 'bitcoin', name: 'Bitcoin' },
  ETH: { id: 'ethereum', name: 'Ethereum' },
  SOL: { id: 'solana', name: 'Solana' },
  ADA: { id: 'cardano', name: 'Cardano' },
  DOGE: { id: 'dogecoin', name: 'Dogecoin' },
};
const ASSET_IDS = Object.values(ASSETS).map(a => a.id);

let priceCache = { data: null, fetchedAt: 0 };
const CACHE_TTL_MS = 30_000;

async function getLivePrices() {
  const now = Date.now();
  if (priceCache.data && now - priceCache.fetchedAt < CACHE_TTL_MS) {
    return priceCache.data;
  }

  const url = `https://api.coincap.io/v2/assets?ids=${ASSET_IDS.join(',')}`;

  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    if (priceCache.data) return priceCache.data;
    throw err;
  }

  if (!res.ok) {
    if (priceCache.data) return priceCache.data;
    throw new Error(`CoinCap error: ${res.status}`);
  }

  const json = await res.json();
  const rows = json.data || [];
  const bySymbol = {};
  for (const [symbol, meta] of Object.entries(ASSETS)) {
    const row = rows.find(r => r.id === meta.id);
    if (!row) continue;
    bySymbol[symbol] = {
      symbol,
      name: meta.name,
      price: parseFloat(row.priceUsd),
      change24h: parseFloat(row.changePercent24Hr) || 0,
    };
  }

  if (Object.keys(bySymbol).length === 0 && priceCache.data) {
    return priceCache.data;
  }

  priceCache = { data: bySymbol, fetchedAt: now };
  return bySymbol;
}

// ---- Auth helpers -------------------------------------------------------
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ---- Auth routes ----------------------------------------------------------
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: 'Username required; password must be 6+ characters' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) return res.status(409).json({ error: 'Username already taken' });

  const hash = await bcrypt.hash(password, 10);
  const info = db.prepare(
    'INSERT INTO users (username, password_hash, cash_balance) VALUES (?, ?, ?)'
  ).run(username, hash, 10000);

  const token = jwt.sign({ userId: info.lastInsertRowid }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username, cashBalance: 10000 });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user) return res.status(401).json({ error: 'Invalid username or password' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, username: user.username, cashBalance: user.cash_balance });
});

// ---- Market data (public) ------------------------------------------------
app.get('/api/market/prices', async (req, res) => {
  try {
    const prices = await getLivePrices();
    res.json(Object.values(prices));
  } catch (err) {
    res.status(502).json({ error: 'Could not fetch live prices', detail: err.message });
  }
});

app.get('/api/market/history/:symbol', async (req, res) => {
  const symbol = req.params.symbol.toUpperCase();
  const asset = ASSETS[symbol];
  if (!asset) return res.status(404).json({ error: 'Unknown symbol' });
  try {
    const end = Date.now();
    const start = end - 7 * 24 * 60 * 60 * 1000;
    const url = `https://api.coincap.io/v2/assets/${asset.id}/history?interval=h6&start=${start}&end=${end}`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error(`CoinCap error: ${r.status}`);
    const json = await r.json();
    const points = (json.data || []).map(pt => ({ t: pt.time, p: parseFloat(pt.priceUsd) }));
    res.json(points);
  } catch (err) {
    res.status(502).json({ error: 'Could not fetch price history', detail: err.message });
  }
});

// ---- Portfolio (auth) -----------------------------------------------------
app.get('/api/portfolio', authMiddleware, async (req, res) => {
  const user = db.prepare('SELECT id, username, cash_balance FROM users WHERE id = ?').get(req.userId);
  const holdings = db.prepare(
    'SELECT symbol, quantity FROM holdings WHERE user_id = ? AND quantity > 0'
  ).all(req.userId);

  let prices = {};
  try {
    prices = await getLivePrices();
  } catch {
    // fine — return holdings with null current value
  }

  const enriched = holdings.map(h => {
    const p = prices[h.symbol];
    const currentPrice = p ? p.price : null;
    return {
      symbol: h.symbol,
      name: ASSETS[h.symbol]?.name || h.symbol,
      quantity: h.quantity,
      currentPrice,
      marketValue: currentPrice ? currentPrice * h.quantity : null,
      change24h: p ? p.change24h : null,
    };
  });

  const holdingsValue = enriched.reduce((sum, h) => sum + (h.marketValue || 0), 0);

  res.json({
    username: user.username,
    cashBalance: user.cash_balance,
    holdings: enriched,
    holdingsValue,
    totalValue: user.cash_balance + holdingsValue,
  });
});

// ---- Trade engine (auth) ---------------------------------------------------
app.post('/api/trade', authMiddleware, async (req, res) => {
  const { symbol, side, quantity } = req.body || {};
  const sym = (symbol || '').toUpperCase();
  const qty = Number(quantity);

  if (!ASSETS[sym]) return res.status(400).json({ error: 'Unknown symbol' });
  if (!['buy', 'sell'].includes(side)) return res.status(400).json({ error: 'Side must be buy or sell' });
  if (!qty || qty <= 0) return res.status(400).json({ error: 'Quantity must be a positive number' });

  let prices;
  try {
    prices = await getLivePrices();
  } catch (err) {
    return res.status(502).json({ error: 'Could not fetch live price to execute trade' });
  }
  const price = prices[sym]?.price;
  if (!price) return res.status(502).json({ error: 'Price unavailable for this asset right now' });

  const total = price * qty;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  const holding = db.prepare('SELECT * FROM holdings WHERE user_id = ? AND symbol = ?').get(req.userId, sym);

  const runTrade = db.transaction(() => {
    if (side === 'buy') {
      if (user.cash_balance < total) throw new Error('INSUFFICIENT_FUNDS');
      db.prepare('UPDATE users SET cash_balance = cash_balance - ? WHERE id = ?').run(total, req.userId);
      if (holding) {
        db.prepare('UPDATE holdings SET quantity = quantity + ? WHERE id = ?').run(qty, holding.id);
      } else {
        db.prepare('INSERT INTO holdings (user_id, symbol, quantity) VALUES (?, ?, ?)').run(req.userId, sym, qty);
      }
    } else {
      const owned = holding ? holding.quantity : 0;
      if (owned < qty) throw new Error('INSUFFICIENT_HOLDINGS');
      db.prepare('UPDATE users SET cash_balance = cash_balance + ? WHERE id = ?').run(total, req.userId);
      db.prepare('UPDATE holdings SET quantity = quantity - ? WHERE id = ?').run(qty, holding.id);
    }
    db.prepare(
      'INSERT INTO trades (user_id, symbol, side, quantity, price, total) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(req.userId, sym, side, qty, price, total);
  });

  try {
    runTrade();
  } catch (err) {
    if (err.message === 'INSUFFICIENT_FUNDS') return res.status(400).json({ error: 'Not enough cash for this trade' });
    if (err.message === 'INSUFFICIENT_HOLDINGS') return res.status(400).json({ error: "You don't own enough of this asset to sell" });
    return res.status(500).json({ error: 'Trade failed', detail: err.message });
  }

  res.json({ ok: true, symbol: sym, side, quantity: qty, price, total });
});

// ---- Trade history (auth) --------------------------------------------------
app.get('/api/history', authMiddleware, (req, res) => {
  const rows = db.prepare(
    'SELECT symbol, side, quantity, price, total, timestamp FROM trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT 200'
  ).all(req.userId);
  res.json(rows);
});

app.get('/api/assets', (req, res) => {
  res.json(Object.entries(ASSETS).map(([symbol, meta]) => ({ symbol, name: meta.name })));
});

app.listen(PORT, () => {
  console.log(`TradeSim backend running at http://localhost:${PORT}`);
});
