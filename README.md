# Ledger — Paper Trading Terminal

A full-stack trading simulator for a CS project: real-money-style account with
$10,000 starting cash, real crypto prices (via CoinGecko's free public API),
buy/sell order execution, portfolio valuation, and trade history — all backed
by an Express + SQLite server with JWT auth.

This does **not** reuse any code, branding, or content from any external site.
It's built from scratch with an original "ledger / ticker-tape" visual style.

## Stack
- **Backend:** Node.js, Express, SQLite (via `better-sqlite3`), JWT auth, bcrypt password hashing
- **Frontend:** Plain HTML/CSS/JS (no build step — just open it through the server)
- **Market data:** [CoinGecko public API](https://www.coingecko.com/en/api) — free, no API key needed

## Project structure

