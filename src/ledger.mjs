// The rebuild's ledger: one small SQLite file in place of the whole-state JSON
// snapshot. Each change is one transaction, so a monitor check and a research session can no longer
// overwrite each other's state, and nothing waits on a global lock to stay consistent.
// node:sqlite ships with Node 22. No dependency was added.
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS accounts (broker TEXT PRIMARY KEY, account_ref TEXT, currency TEXT, cash REAL, buying_power REAL, value REAL,
  source TEXT, as_of INTEGER, last_error_at INTEGER, error_class TEXT, sample INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS positions (id TEXT PRIMARY KEY, broker TEXT NOT NULL, instrument TEXT NOT NULL, instrument_type TEXT NOT NULL, name TEXT,
  side TEXT NOT NULL DEFAULT 'long', quantity REAL NOT NULL DEFAULT 0, cost_basis REAL, basis_status TEXT NOT NULL DEFAULT 'confirmed',
  realized_pnl REAL NOT NULL DEFAULT 0, fees REAL NOT NULL DEFAULT 0, opened_at INTEGER, closed_at INTEGER, status TEXT NOT NULL DEFAULT 'open',
  evidence_id TEXT, resolution_at INTEGER, plan TEXT, protection_mode TEXT NOT NULL DEFAULT 'none', protection_verified INTEGER NOT NULL DEFAULT 0,
  protection_interval_ms INTEGER, protection_last_ok_at INTEGER, sample INTEGER NOT NULL DEFAULT 0, UNIQUE (broker, instrument, side));
CREATE TABLE IF NOT EXISTS orders (client_id TEXT PRIMARY KEY, broker TEXT NOT NULL, instrument TEXT NOT NULL, instrument_type TEXT NOT NULL, side TEXT NOT NULL, outcome_side TEXT,
  order_type TEXT, requested_qty REAL, limit_price REAL, notional REAL, state TEXT NOT NULL, broker_id TEXT, filled_qty REAL NOT NULL DEFAULT 0,
  avg_price REAL, fees REAL NOT NULL DEFAULT 0, reason TEXT, evidence_id TEXT, plan TEXT, created_at INTEGER NOT NULL, submitted_at INTEGER, updated_at INTEGER NOT NULL,
  sample INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS fills (id INTEGER PRIMARY KEY, client_id TEXT NOT NULL, fill_key TEXT NOT NULL UNIQUE, qty REAL NOT NULL, price REAL NOT NULL,
  fee REAL NOT NULL DEFAULT 0, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quotes (broker TEXT NOT NULL, instrument TEXT NOT NULL, price REAL, bid REAL, ask REAL, depth TEXT, source TEXT,
  as_of INTEGER, last_error_at INTEGER, sample INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (broker, instrument));
CREATE TABLE IF NOT EXISTS alerts (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, severity TEXT NOT NULL, subject TEXT, text TEXT NOT NULL,
  at INTEGER NOT NULL, resolved_at INTEGER, dedupe TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS evidence (id TEXT PRIMARY KEY, subject TEXT, role TEXT, verdict TEXT, status TEXT NOT NULL, packet TEXT NOT NULL,
  strategy_version TEXT, created_at INTEGER NOT NULL, expires_at INTEGER, sample INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS jobs (name TEXT PRIMARY KEY, priority INTEGER NOT NULL, interval_ms INTEGER NOT NULL, last_started_at INTEGER,
  last_ok_at INTEGER, last_error_at INTEGER, error_class TEXT, runs INTEGER NOT NULL DEFAULT 0, late INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL, status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  error_class TEXT, detail TEXT, created_at INTEGER NOT NULL, delivered_at INTEGER);
CREATE TABLE IF NOT EXISTS health (component TEXT PRIMARY KEY, status TEXT NOT NULL, last_ok_at INTEGER, last_error_at INTEGER, error_class TEXT, detail TEXT);
CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS trades (id INTEGER PRIMARY KEY, broker TEXT, instrument TEXT, entry REAL, exit REAL, ret REAL, dollars REAL, why TEXT,
  opened_at INTEGER, closed_at INTEGER, paper INTEGER NOT NULL DEFAULT 0, basis_status TEXT, source TEXT);
CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL, broker TEXT, subject TEXT, text TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'live', dedupe TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS legacy_import (id INTEGER PRIMARY KEY, source TEXT NOT NULL, raw TEXT NOT NULL, imported_at INTEGER NOT NULL);
`;

export const TERMINAL = new Set(["filled", "rejected", "cancelled", "blocked"]);
// Allowed moves. "unknown" can resolve to anything; nothing leaves a terminal state.
const NEXT = {
  intent: ["submitted", "unknown", "rejected", "blocked", "cancelled", "partially_filled", "filled"],
  submitted: ["partially_filled", "filled", "rejected", "cancelled", "unknown"],
  partially_filled: ["partially_filled", "filled", "cancelled", "unknown"],
  unknown: ["submitted", "partially_filled", "filled", "rejected", "cancelled", "unknown"],
};

export function openLedger(file = ":memory:", { readOnly = false } = {}) {
  const db = new DatabaseSync(file, readOnly ? { readOnly: true } : {});
  // Wait up to 5 s for another writer (a job, the dashboard reader, a backfill) instead of failing at once; without it
  // a lease release during shutdown could fail and the next process waited for the lease to expire.
  db.exec("PRAGMA busy_timeout = 5000;");
  if (!readOnly) { db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;"); db.exec(SCHEMA); }
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  // Synchronous body only: nothing can interleave between BEGIN and COMMIT.
  const tx = fn => {
    db.exec("BEGIN IMMEDIATE");
    try { const out = fn(); db.exec("COMMIT"); return out; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  // Sale fills of one holding since it opened: quantity, gross proceeds and fees.
  const soldSince = p => {
    const rows = all(`SELECT f.qty, f.price, f.fee FROM fills f JOIN orders o ON o.client_id = f.client_id WHERE o.broker = ? AND o.instrument = ?
      AND COALESCE(o.outcome_side, 'long') = ? AND o.side = 'sell' AND f.at >= ?`, p.broker, p.instrument, p.side, p.opened_at ?? 0);
    return rows.reduce((t, f) => ({ qty: t.qty + f.qty, gross: t.gross + f.qty * f.price, fees: t.fees + f.fee }), { qty: 0, gross: 0, fees: 0 });
  };
  const L = {
    db, all, get, run, tx, close: () => db.close(),
    meta: (key, value) => value === undefined ? get("SELECT value FROM meta WHERE key = ?", key)?.value
      : run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value)),

    // ---- orders ----
    order: clientId => get("SELECT * FROM orders WHERE client_id = ?", clientId),
    openOrders: () => all(`SELECT * FROM orders WHERE state NOT IN (${[...TERMINAL].map(() => "?").join(",")}) ORDER BY created_at`, ...TERMINAL),
    // An earlier order on the same instrument and side that has not reached a final state blocks a new one.
    pendingFor: (broker, instrument, side) => get(`SELECT * FROM orders WHERE broker = ? AND instrument = ? AND side = ? AND state NOT IN (${[...TERMINAL].map(() => "?").join(",")})`,
      broker, instrument, side, ...TERMINAL),
    recordIntent(o, now) {
      run(`INSERT INTO orders (client_id, broker, instrument, instrument_type, side, outcome_side, order_type, requested_qty, limit_price, notional, state, evidence_id, plan, created_at, updated_at, sample)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'intent', ?, ?, ?, ?, ?)`, o.clientId, o.broker, o.instrument, o.instrumentType, o.side, o.outcomeSide ?? null, o.orderType ?? null,
        o.quantity ?? null, o.limitPrice ?? null, o.notional ?? null, o.evidenceId ?? null, o.plan ? JSON.stringify(o.plan) : null, now, now, o.sample ? 1 : 0);
    },
    // Moves an order along its lifecycle. Filled quantity never goes down, and a final state is final.
    setOrderState(clientId, next, fields = {}, now = Date.now()) {
      const o = L.order(clientId);
      if (!o) throw Error(`No order ${clientId}`);
      if (o.state === next && next !== "partially_filled") return o;
      if (TERMINAL.has(o.state)) return o;
      if (!NEXT[o.state]?.includes(next)) throw Error(`Order ${clientId} cannot move from ${o.state} to ${next}`);
      const filled = Number.isFinite(fields.filledQty) ? Math.max(o.filled_qty, fields.filledQty) : o.filled_qty;
      run(`UPDATE orders SET state = ?, broker_id = COALESCE(?, broker_id), filled_qty = ?, avg_price = COALESCE(?, avg_price), fees = COALESCE(?, fees),
        reason = COALESCE(?, reason), submitted_at = COALESCE(submitted_at, ?), updated_at = ? WHERE client_id = ?`,
        next, fields.brokerId ?? null, filled, fields.avgPrice ?? null, fields.fees ?? null, fields.reason ?? null, next === "submitted" ? now : null, now, clientId);
      return L.order(clientId);
    },

    // ---- fills and positions (basis from actual quantities, prices and fees) ----
    // fillKey makes a fill idempotent: the same broker fill seen twice is booked once.
    applyFill({ clientId, fillKey, qty, price, fee = 0, at }) {
      const o = L.order(clientId);
      if (!o) throw Error(`No order ${clientId}`);
      if (!(qty > 0) || !(price >= 0)) throw Error("A fill needs a positive quantity and a price");
      if (get("SELECT 1 FROM fills WHERE fill_key = ?", fillKey)) return { duplicate: true };
      run("INSERT INTO fills (client_id, fill_key, qty, price, fee, at) VALUES (?, ?, ?, ?, ?, ?)", clientId, fillKey, qty, price, fee, at);
      const side = o.outcome_side || "long";
      const id = positionId(o.broker, o.instrument, side);
      let p = get("SELECT * FROM positions WHERE id = ?", id);
      if (o.side === "buy") {
        if (!p) {
          // The order's exit plan travels with the position; with a stop, Richie's watcher owns it (never "broker protected").
          const hasStop = Number.isFinite(Number(JSON.parse(o.plan || "{}").stop));
          run(`INSERT INTO positions (id, broker, instrument, instrument_type, side, quantity, cost_basis, fees, opened_at, status, evidence_id, plan, protection_mode, sample)
            VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, 'open', ?, ?, ?, ?)`, id, o.broker, o.instrument, o.instrument_type, side, at, o.evidence_id, o.plan, hasStop ? "richie_watcher" : "none", o.sample);
          p = get("SELECT * FROM positions WHERE id = ?", id);
        } else if (p.status === "closed") {
          // Bought again after a full exit: a new holding with this order's plan, evidence and open time. Keeping the old
          // row's opened_at would trip the 20-trading-day exit at once and mix the old trade's P&L into the new one.
          const hasStop = Number.isFinite(Number(JSON.parse(o.plan || "{}").stop));
          run(`UPDATE positions SET quantity = 0, cost_basis = 0, fees = 0, realized_pnl = 0, basis_status = 'confirmed', opened_at = ?, closed_at = NULL, evidence_id = ?, plan = ?,
            protection_mode = ?, protection_verified = 0, protection_last_ok_at = NULL, sample = ? WHERE id = ?`, at, o.evidence_id, o.plan, hasStop ? "richie_watcher" : "none", o.sample, id);
          p = get("SELECT * FROM positions WHERE id = ?", id);
        }
        run("UPDATE positions SET quantity = quantity + ?, cost_basis = COALESCE(cost_basis, 0) + ?, fees = fees + ?, status = 'open', closed_at = NULL WHERE id = ?",
          qty, qty * price + fee, fee, id);
      } else {
        if (!p || !(p.quantity > 0)) {   // a sell with no booked position: record it, do not invent a basis
          L.alert({ kind: "unmatched_fill", severity: "important", subject: o.instrument, text: `A sell fill for ${o.instrument} has no booked position. Basis unknown; reconcile before reporting P&L.`, at, dedupe: `unmatched_fill:${fillKey}` });
          return { unmatched: true };
        }
        const sold = Math.min(qty, p.quantity), avg = p.cost_basis == null ? null : p.cost_basis / p.quantity;
        const realized = avg == null ? 0 : sold * price - fee - sold * avg;
        const left = p.quantity - sold;
        // A position sold out completely is a closed trade for the scoreboard: every sale since it opened (this fill
        // included), at the average cost, net of fees. Counting only the last fill dropped earlier partial sales.
        if (left <= 1e-9) {
          const s = soldSince(p);
          const cost = avg == null ? null : avg * s.qty;
          L.addTrade({ broker: o.broker, instrument: o.instrument, entry: avg, exit: s.gross / s.qty, ret: cost ? (s.gross - s.fees) / cost - 1 : null,
            dollars: cost, why: JSON.parse(o.plan || "{}").why || "sold", openedAt: p.opened_at, closedAt: at, paper: false, basisStatus: p.basis_status, source: "live" });
        }
        run(`UPDATE positions SET quantity = ?, cost_basis = ?, realized_pnl = realized_pnl + ?, fees = fees + ?, status = ?, closed_at = ? WHERE id = ?`,
          left, avg == null ? null : avg * left, realized, fee, left > 1e-9 ? "open" : "closed", left > 1e-9 ? null : at, id);
      }
      return { position: get("SELECT * FROM positions WHERE id = ?", id) };
    },
    // A Kalshi market settled: the position closes at its payout (revenue from the broker's settlement record).
    settlePosition(id, { payout, result, at }) {
      const p = L.position(id);
      if (!p || p.status !== "open") return null;
      const cost = p.cost_basis ?? null, pnl = cost == null ? null : payout - cost;
      run("UPDATE positions SET quantity = 0, cost_basis = 0, realized_pnl = realized_pnl + ?, status = 'closed', closed_at = ? WHERE id = ?", pnl ?? 0, at, id);
      // The trade row covers the whole holding: contracts sold before settlement (2026-11-02: 3.36 of 6 sold at 91c) and the
      // ones that settled, at the average cost.
      const s = soldSince(p), avg = cost != null && p.quantity ? cost / p.quantity : null, n = p.quantity + s.qty, total = avg == null ? null : avg * n;
      L.addTrade({ broker: p.broker, instrument: p.instrument, entry: avg, exit: n ? (payout + s.gross) / n : null,
        ret: total ? (payout + s.gross - s.fees) / total - 1 : null, dollars: total, why: `settled ${result}`, openedAt: p.opened_at, closedAt: at, paper: false, basisStatus: p.basis_status, source: "live" });
      return { pnl, payout };
    },
    positions: (status = "open") => all("SELECT * FROM positions WHERE status = ? ORDER BY broker, instrument", status),
    position: id => get("SELECT * FROM positions WHERE id = ?", id),
    setProtection(id, { mode, verified = false, intervalMs, lastOkAt }) {
      run(`UPDATE positions SET protection_mode = COALESCE(?, protection_mode), protection_verified = ?, protection_interval_ms = COALESCE(?, protection_interval_ms),
        protection_last_ok_at = COALESCE(?, protection_last_ok_at) WHERE id = ?`, mode ?? null, verified ? 1 : 0, intervalMs ?? null, lastOkAt ?? null, id);
    },
    fillsFor: clientId => all("SELECT * FROM fills WHERE client_id = ? ORDER BY at", clientId),

    // ---- readings ----
    setAccount(a) {
      run(`INSERT INTO accounts (broker, account_ref, currency, cash, buying_power, value, source, as_of, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(broker) DO UPDATE SET account_ref = excluded.account_ref, currency = excluded.currency, cash = excluded.cash, buying_power = excluded.buying_power,
        value = excluded.value, source = excluded.source, as_of = excluded.as_of, sample = excluded.sample`,
        a.broker, a.accountRef ?? null, a.currency ?? "USD", a.cash, a.buyingPower ?? null, a.value, a.source, a.asOf, a.sample ? 1 : 0);
    },
    // A failed read keeps the last good numbers and their old time; it never writes zeros.
    accountError(broker, cls, at) {
      run(`INSERT INTO accounts (broker, last_error_at, error_class) VALUES (?, ?, ?)
        ON CONFLICT(broker) DO UPDATE SET last_error_at = excluded.last_error_at, error_class = excluded.error_class`, broker, at, cls);
    },
    accounts: () => all("SELECT * FROM accounts ORDER BY broker"),
    account: broker => get("SELECT * FROM accounts WHERE broker = ?", broker),
    setQuote(q) {
      run(`INSERT INTO quotes (broker, instrument, price, bid, ask, depth, source, as_of, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(broker, instrument) DO UPDATE SET price = excluded.price, bid = excluded.bid, ask = excluded.ask, depth = excluded.depth,
        source = excluded.source, as_of = excluded.as_of, sample = excluded.sample`,
        q.broker, q.instrument, q.price ?? null, q.bid ?? null, q.ask ?? null, q.depth ? JSON.stringify(q.depth) : null, q.source, q.asOf, q.sample ? 1 : 0);
    },
    quoteError(broker, instrument, at) {
      run(`INSERT INTO quotes (broker, instrument, last_error_at) VALUES (?, ?, ?) ON CONFLICT(broker, instrument) DO UPDATE SET last_error_at = excluded.last_error_at`, broker, instrument, at);
    },
    quote: (broker, instrument) => get("SELECT * FROM quotes WHERE broker = ? AND instrument = ?", broker, instrument),

    // ---- health, alerts, notifications, jobs, leases ----
    healthOk: (component, at, detail = null) => run(`INSERT INTO health (component, status, last_ok_at, detail) VALUES (?, 'ok', ?, ?)
      ON CONFLICT(component) DO UPDATE SET status = 'ok', last_ok_at = excluded.last_ok_at, detail = excluded.detail`, component, at, detail),
    healthError: (component, cls, at, detail = null, status = "degraded") => run(`INSERT INTO health (component, status, last_error_at, error_class, detail) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(component) DO UPDATE SET status = excluded.status, last_error_at = excluded.last_error_at, error_class = excluded.error_class, detail = excluded.detail`,
      component, status, at, cls, detail),
    health: () => all("SELECT * FROM health ORDER BY component"),
    // dedupe keeps a repeating problem to one open alert.
    alert({ kind, severity = "important", subject = null, text, at, dedupe = null }) {
      if (dedupe && get("SELECT 1 FROM alerts WHERE dedupe = ? AND resolved_at IS NULL", dedupe)) return null;
      if (dedupe) run("DELETE FROM alerts WHERE dedupe = ? AND resolved_at IS NOT NULL", dedupe);
      return run("INSERT INTO alerts (kind, severity, subject, text, at, dedupe) VALUES (?, ?, ?, ?, ?, ?)", kind, severity, subject, text, at, dedupe).lastInsertRowid;
    },
    resolveAlert: (dedupe, at) => run("UPDATE alerts SET resolved_at = ? WHERE dedupe = ? AND resolved_at IS NULL", at, dedupe),
    alerts: (open = true) => all(`SELECT * FROM alerts ${open ? "WHERE resolved_at IS NULL" : ""} ORDER BY at DESC LIMIT 200`),
    notification: (kind, text, at) => Number(run("INSERT INTO notifications (kind, text, status, created_at) VALUES (?, ?, 'pending', ?)", kind, text, at).lastInsertRowid),
    notificationResult: (id, { status, attempts, errorClass = null, detail = null, at }) =>
      run("UPDATE notifications SET status = ?, attempts = ?, error_class = ?, detail = ?, delivered_at = ? WHERE id = ?", status, attempts, errorClass, detail, status === "delivered" ? at : null, id),
    notifications: () => all("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100"),
    job: name => get("SELECT * FROM jobs WHERE name = ?", name),
    jobs: () => all("SELECT * FROM jobs ORDER BY priority, name"),
    defineJob: (name, priority, intervalMs) => run(`INSERT INTO jobs (name, priority, interval_ms) VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET priority = excluded.priority, interval_ms = excluded.interval_ms`, name, priority, intervalMs),
    // One owner at a time for anything that can submit orders (daemon or CLI, never both).
    lease(name, owner, ttlMs, now = Date.now()) {
      return tx(() => {
        const held = get("SELECT * FROM leases WHERE name = ?", name);
        if (held && held.owner !== owner && held.expires_at > now) return false;
        run("INSERT INTO leases (name, owner, expires_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at", name, owner, now + ttlMs);
        return true;
      });
    },
    holds: (name, owner, now = Date.now()) => { const l = get("SELECT * FROM leases WHERE name = ?", name); return Boolean(l && l.owner === owner && l.expires_at > now); },
    release: (name, owner) => run("DELETE FROM leases WHERE name = ? AND owner = ?", name, owner),
    saveEvidence(e) {
      run(`INSERT INTO evidence (id, subject, role, verdict, status, packet, strategy_version, created_at, expires_at, sample) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET verdict = excluded.verdict, status = excluded.status, packet = excluded.packet, expires_at = excluded.expires_at`,
        e.id, e.subject, e.role, e.verdict ?? null, e.status, JSON.stringify(e.packet), e.strategyVersion ?? null, e.createdAt, e.expiresAt ?? null, e.sample ? 1 : 0);
    },
    evidence: () => all("SELECT * FROM evidence ORDER BY created_at DESC LIMIT 100"),
    evidenceFor: subject => all("SELECT * FROM evidence WHERE subject = ? ORDER BY created_at DESC", subject),
    addTrade: t => run(`INSERT INTO trades (broker, instrument, entry, exit, ret, dollars, why, opened_at, closed_at, paper, basis_status, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      t.broker, t.instrument, t.entry ?? null, t.exit ?? null, t.ret ?? null, t.dollars ?? null, t.why ?? null, t.openedAt ?? null, t.closedAt ?? null, t.paper ? 1 : 0, t.basisStatus ?? null, t.source ?? null),
    // The activity timeline: what Richie did, in words (sessions, orders, exits, commands, chat, imported history).
    event: ({ at, kind, broker = null, subject = null, text, source = "live", dedupe = null }) =>
      run("INSERT INTO events (at, kind, broker, subject, text, source, dedupe) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe) DO NOTHING", at, kind, broker, subject, String(text).slice(0, 1000), source, dedupe),
    events: (limit = 300) => all("SELECT * FROM events ORDER BY at DESC, id DESC LIMIT ?", limit),
    trades: (paper = false) => all("SELECT * FROM trades WHERE paper = ? ORDER BY closed_at DESC", paper ? 1 : 0),
  };
  return L;
}

export const positionId = (broker, instrument, side = "long") => `${broker}:${instrument}:${side}`;
