// db.js — SQLite schema + connection.
// Uses better-sqlite3: synchronous, no async ceremony, fine for a project this size.

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tradesim.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    cash_balance  REAL NOT NULL DEFAULT 10000,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS holdings (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol    TEXT NOT NULL,
    quantity  REAL NOT NULL DEFAULT 0,
    UNIQUE(user_id, symbol)
  );

  CREATE TABLE IF NOT EXISTS trades (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    symbol     TEXT NOT NULL,
    side       TEXT NOT NULL CHECK (side IN ('buy','sell')),
    quantity   REAL NOT NULL,
    price      REAL NOT NULL,
    total      REAL NOT NULL,
    timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    value      REAL NOT NULL,
    timestamp  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

module.exports = db;
