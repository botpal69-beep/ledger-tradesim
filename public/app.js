// app.js — TradeSim frontend (vanilla JS, no build step)

const API = ''; // same-origin, backend serves this file too

const state = {
  token: localStorage.getItem('tradesim_token') || null,
  username: localStorage.getItem('tradesim_username') || null,
  assets: [],
  prices: {},
  activeTab: 'dashboard',
  chartAsset: 'BTC',
  tradeAsset: 'BTC',
  tradeSide: 'buy',
};

// ---------- fetch helpers ----------
async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(API + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}
function fmtQty(n) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
}
function fmtPct(n) {
  if (n === null || n === undefined) return '';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(2)}%`;
}

// ---------- auth ----------
function isLoggedIn() { return !!state.token; }

function login(token, username) {
  state.token = token;
  state.username = username;
  localStorage.setItem('tradesim_token', token);
  localStorage.setItem('tradesim_username', username);
  render();
  bootAuthenticated();
}

function logout() {
  state.token = null;
  state.username = null;
  localStorage.removeItem('tradesim_token');
  localStorage.removeItem('tradesim_username');
  render();
}

document.getElementById('logoutBtn').addEventListener('click', logout);

document.querySelectorAll('.auth-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.auth-tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const which = btn.dataset.auth;
    document.getElementById('loginForm').classList.toggle('hidden', which !== 'login');
    document.getElementById('registerForm').classList.toggle('hidden', which !== 'register');
  });
});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    });
    login(data.token, data.username);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

document.getElementById('registerForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const errEl = document.getElementById('registerError');
  errEl.textContent = '';
  try {
    const data = await api('/api/register', {
      method: 'POST',
      body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
    });
    login(data.token, data.username);
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- tabs ----------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeTab = btn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    ['dashboard', 'trade', 'history'].forEach(name => {
      document.getElementById(`${name}View`).classList.toggle('hidden', name !== state.activeTab);
    });
    if (state.activeTab === 'dashboard') refreshDashboard();
    if (state.activeTab === 'trade') refreshTradeView();
    if (state.activeTab === 'history') refreshHistory();
  });
});

// ---------- render top-level auth state ----------
function render() {
  const loggedIn = isLoggedIn();
  document.getElementById('authView').classList.toggle('hidden', loggedIn);
  document.getElementById('userBar').classList.toggle('hidden', !loggedIn);
  document.getElementById('tabNav').classList.toggle('hidden', !loggedIn);
  ['dashboard', 'trade', 'history'].forEach(name => {
    document.getElementById(`${name}View`).classList.toggle('hidden', !loggedIn || state.activeTab !== name);
  });
  if (loggedIn) {
    document.getElementById('headerUsername').textContent = state.username;
  }
}

// ---------- ticker tape ----------
async function loadAssetsAndTape() {
  try {
    if (state.assets.length === 0) {
      state.assets = await api('/api/assets');
      populateAssetSelects();
    }
    const prices = await api('/api/market/prices');
    state.prices = Object.fromEntries(prices.map(p => [p.symbol, p]));
    renderTape(prices);
    if (isLoggedIn() && state.activeTab === 'dashboard') renderHoldingsFromCache();
    if (isLoggedIn() && state.activeTab === 'trade') renderTradeQuote();
  } catch (err) {
    document.getElementById('tapeTrack').textContent = 'Live prices unavailable — check your connection.';
  }
}

function renderTape(prices) {
  const track = document.getElementById('tapeTrack');
  const parts = prices.map(p => {
    const dir = p.change24h >= 0 ? 'up' : 'down';
    const arrow = p.change24h >= 0 ? '▲' : '▼';
    return `<span>${p.symbol} ${fmtMoney(p.price)} <span class="${dir}">${arrow} ${fmtPct(p.change24h)}</span></span>`;
  });
  track.innerHTML = parts.join('<span class="sep">·</span>') + '<span class="sep">·</span>' + parts.join('<span class="sep">·</span>');
}

function populateAssetSelects() {
  const opts = state.assets.map(a => `<option value="${a.symbol}">${a.symbol} — ${a.name}</option>`).join('');
  document.getElementById('chartAssetSelect').innerHTML = opts;
  document.getElementById('tradeAssetSelect').innerHTML = opts;
  document.getElementById('chartAssetSelect').value = state.chartAsset;
  document.getElementById('tradeAssetSelect').value = state.tradeAsset;
}

// ---------- dashboard ----------
let latestPortfolio = null;

async function refreshDashboard() {
  try {
    latestPortfolio = await api('/api/portfolio');
    document.getElementById('cashBalance').textContent = fmtMoney(latestPortfolio.cashBalance);
    document.getElementById('holdingsValue').textContent = fmtMoney(latestPortfolio.holdingsValue);
    document.getElementById('totalValue').textContent = fmtMoney(latestPortfolio.totalValue);
    document.getElementById('headerTotalValue').textContent = fmtMoney(latestPortfolio.totalValue);
    renderHoldingsTable(latestPortfolio.holdings);
    drawChart(state.chartAsset);
  } catch (err) {
    console.error(err);
  }
}

function renderHoldingsFromCache() {
  if (latestPortfolio) {
    document.getElementById('headerTotalValue').textContent = fmtMoney(latestPortfolio.totalValue);
  }
}

function renderHoldingsTable(holdings) {
  const tbody = document.querySelector('#holdingsTable tbody');
  const emptyNote = document.getElementById('holdingsEmpty');
  tbody.innerHTML = '';
  if (!holdings.length) {
    emptyNote.classList.remove('hidden');
    return;
  }
  emptyNote.classList.add('hidden');
  holdings.forEach(h => {
    const tr = document.createElement('tr');
    const dir = (h.change24h ?? 0) >= 0 ? 'up' : 'down';
    tr.innerHTML = `
      <td>${h.symbol} <span style="color:var(--ink-soft)">${h.name}</span></td>
      <td>${fmtQty(h.quantity)}</td>
      <td>${fmtMoney(h.currentPrice)}</td>
      <td class="${dir}">${fmtPct(h.change24h)}</td>
      <td>${fmtMoney(h.marketValue)}</td>
    `;
    tbody.appendChild(tr);
  });
}

document.getElementById('chartAssetSelect').addEventListener('change', (e) => {
  state.chartAsset = e.target.value;
  document.getElementById('chartAssetLabel').textContent =
    state.assets.find(a => a.symbol === state.chartAsset)?.name || state.chartAsset;
  drawChart(state.chartAsset);
});

async function drawChart(symbol) {
  const canvas = document.getElementById('priceChart');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  let points;
  try {
    points = await api(`/api/market/history/${symbol}`);
  } catch {
    return;
  }
  if (!points.length) return;

  const prices = points.map(p => p.p);
  const min = Math.min(...prices), max = Math.max(...prices);
  const pad = 24;
  const w = canvas.width - pad * 2;
  const h = canvas.height - pad * 2;
  const up = prices[prices.length - 1] >= prices[0];

  ctx.strokeStyle = up ? '#1F5C4A' : '#8C3A2B';
  ctx.lineWidth = 2;
  ctx.beginPath();
  points.forEach((pt, i) => {
    const x = pad + (i / (points.length - 1)) * w;
    const y = pad + h - ((pt.p - min) / (max - min || 1)) * h;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.lineTo(pad + w, pad + h);
  ctx.lineTo(pad, pad + h);
  ctx.closePath();
  ctx.fillStyle = up ? 'rgba(31,92,74,0.08)' : 'rgba(140,58,43,0.08)';
  ctx.fill();

  ctx.fillStyle = '#5B5A4C';
  ctx.font = '11px "IBM Plex Mono", monospace';
  ctx.fillText(fmtMoney(max), 4, pad + 4);
  ctx.fillText(fmtMoney(min), 4, pad + h);
}

// ---------- trade ----------
document.getElementById('tradeAssetSelect').addEventListener('change', (e) => {
  state.tradeAsset = e.target.value;
  renderTradeQuote();
});

document.querySelectorAll('.side-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.tradeSide = btn.dataset.side;
    document.querySelectorAll('.side-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tradeSubmit').textContent = state.tradeSide === 'buy' ? 'Buy' : 'Sell';
    document.getElementById('tradeSubmit').style.background =
      state.tradeSide === 'sell' ? 'var(--red)' : 'var(--ink)';
    updateEstimate();
  });
});

document.getElementById('tradeQuantity').addEventListener('input', updateEstimate);

function updateEstimate() {
  const qty = parseFloat(document.getElementById('tradeQuantity').value) || 0;
  const price = state.prices[state.tradeAsset]?.price || 0;
  document.getElementById('tradeEstimate').textContent = fmtMoney(qty * price);
}

function renderTradeQuote() {
  const p = state.prices[state.tradeAsset];
  if (!p) return;
  document.getElementById('tradeQuotePrice').textContent = fmtMoney(p.price);
  const changeEl = document.getElementById('tradeQuoteChange');
  changeEl.textContent = fmtPct(p.change24h);
  changeEl.className = 'change ' + (p.change24h >= 0 ? 'up' : 'down');
  updateEstimate();
}

function refreshTradeView() {
  renderTradeQuote();
}

document.getElementById('tradeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('tradeError');
  const okEl = document.getElementById('tradeSuccess');
  errEl.textContent = '';
  okEl.textContent = '';
  const qty = parseFloat(document.getElementById('tradeQuantity').value);
  if (!qty || qty <= 0) { errEl.textContent = 'Enter a quantity greater than zero.'; return; }

  try {
    const result = await api('/api/trade', {
      method: 'POST',
      body: JSON.stringify({ symbol: state.tradeAsset, side: state.tradeSide, quantity: qty }),
    });
    okEl.textContent = `${result.side === 'buy' ? 'Bought' : 'Sold'} ${fmtQty(result.quantity)} ${result.symbol} at ${fmtMoney(result.price)} — total ${fmtMoney(result.total)}`;
    document.getElementById('tradeQuantity').value = '';
    updateEstimate();
    refreshDashboard();
  } catch (err) {
    errEl.textContent = err.message;
  }
});

// ---------- history ----------
async function refreshHistory() {
  try {
    const trades = await api('/api/history');
    const tbody = document.querySelector('#historyTable tbody');
    const emptyNote = document.getElementById('historyEmpty');
    tbody.innerHTML = '';
    if (!trades.length) { emptyNote.classList.remove('hidden'); return; }
    emptyNote.classList.add('hidden');
    trades.forEach(t => {
      const tr = document.createElement('tr');
      const when = new Date(t.timestamp + 'Z').toLocaleString();
      tr.innerHTML = `
        <td>${when}</td>
        <td>${t.symbol}</td>
        <td class="side-${t.side}">${t.side.toUpperCase()}</td>
        <td>${fmtQty(t.quantity)}</td>
        <td>${fmtMoney(t.price)}</td>
        <td>${fmtMoney(t.total)}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
  }
}

// ---------- boot ----------
function bootAuthenticated() {
  refreshDashboard();
}

async function boot() {
  render();
  await loadAssetsAndTape();
  if (isLoggedIn()) bootAuthenticated();
  setInterval(loadAssetsAndTape, 20000);
}

boot();
