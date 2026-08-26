const fs = require('fs');
const path = require('path');
const session = require('express-session');
const Database = require('better-sqlite3');
const { ROOT_DIR } = require('./config');

const DB_FILE = path.join(ROOT_DIR, 'data', 'sessions.db');
const PRUNE_INTERVAL = 60 * 60 * 1000;

class SqliteStore extends session.Store {
  constructor() {
    super();
    fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
    this.db = new Database(DB_FILE);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        sid        TEXT PRIMARY KEY,
        data       TEXT    NOT NULL,
        expires_at INTEGER NOT NULL
      )
    `);
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)');
    this.prune();
    this.timer = setInterval(() => this.prune(), PRUNE_INTERVAL);
    this.timer.unref();
  }

  prune() {
    try {
      this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    } catch { /* ignore */ }
  }

  expiryOf(sess) {
    const cookie = sess && sess.cookie;
    if (cookie && cookie.expires) return new Date(cookie.expires).getTime();
    const maxAge = (cookie && cookie.originalMaxAge) || 24 * 60 * 60 * 1000;
    return Date.now() + maxAge;
  }

  get(sid, cb) {
    try {
      const row = this.db.prepare('SELECT data, expires_at FROM sessions WHERE sid = ?').get(sid);
      if (!row) return cb(null, null);
      if (row.expires_at <= Date.now()) {
        this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.data));
    } catch (e) { cb(e); }
  }

  set(sid, sess, cb) {
    try {
      this.db.prepare(
        'INSERT INTO sessions (sid, data, expires_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires_at = excluded.expires_at'
      ).run(sid, JSON.stringify(sess), this.expiryOf(sess));
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  destroy(sid, cb) {
    try {
      this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  touch(sid, sess, cb) {
    try {
      this.db.prepare('UPDATE sessions SET expires_at = ? WHERE sid = ?').run(this.expiryOf(sess), sid);
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }

  length(cb) {
    try {
      const row = this.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(Date.now());
      cb(null, row.n);
    } catch (e) { cb(e); }
  }

  clear(cb) {
    try {
      this.db.exec('DELETE FROM sessions');
      cb && cb(null);
    } catch (e) { cb && cb(e); }
  }
}

module.exports = SqliteStore;
