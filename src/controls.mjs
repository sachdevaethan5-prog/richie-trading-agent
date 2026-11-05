// Dashboard controls (CONTROLS.md): Pause / Resume, Run session now, Sell now. The dashboard server only adds a request to this inbox; live Richie reads
// it every few seconds, checks it again and acts through the same code as Telegram commands and stop exits.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export const CONTROL_KINDS = ["pause", "resume", "session", "sell"];
export const MAX_AGE_MS = 60000, MAX_PER_MINUTE = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSITION = /^(robinhood|kalshi):[A-Za-z0-9._-]{1,80}:(long|yes|no)$/;

export function openInbox(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, kind TEXT NOT NULL, args TEXT NOT NULL, email TEXT, via TEXT NOT NULL,
      at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', result TEXT, done_at INTEGER)`);
  const all = (sql, ...a) => db.prepare(sql).all(...a);
  return {
    add: r => db.prepare("INSERT INTO requests (id, kind, args, email, via, at) VALUES (?, ?, ?, ?, ?, ?)").run(r.id, r.kind, JSON.stringify(r.args), r.email ?? null, r.via, r.at),
    has: id => Boolean(db.prepare("SELECT 1 FROM requests WHERE id = ?").get(id)),
    countSince: at => db.prepare("SELECT COUNT(*) AS n FROM requests WHERE at >= ?").get(at).n,
    // Claimed before it runs, so a restart mid-request never runs it twice.
    claim: id => db.prepare("UPDATE requests SET status = 'running' WHERE id = ? AND status = 'pending'").run(id).changes === 1,
    pending: () => all("SELECT * FROM requests WHERE status = 'pending' ORDER BY at"),
    running: () => all("SELECT * FROM requests WHERE status = 'running'"),
    finish: (id, status, result, at) => db.prepare("UPDATE requests SET status = ?, result = ?, done_at = ? WHERE id = ?").run(status, String(result).slice(0, 500), at, id),
    recent: (limit = 20) => all("SELECT id, kind, args, email, via, at, status, result, done_at FROM requests ORDER BY at DESC LIMIT ?", limit),
    close: () => db.close(),
  };
}

// The request body from the page: { id, kind, broker?, positionId?, quantity? }. Returns { problem } or { request }.
export function parseRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { problem: "The request must be a JSON object." };
  const allowed = new Set(["id", "kind", "broker", "positionId", "quantity"]);
  if (Object.keys(body).some(k => !allowed.has(k))) return { problem: "The request has a field controls do not take." };
  if (!UUID.test(String(body.id))) return { problem: "The request needs a fresh id." };
  if (!CONTROL_KINDS.includes(body.kind)) return { problem: "Unknown control." };
  const args = {};
  if (body.kind === "session") {
    if (!["robinhood", "kalshi"].includes(body.broker)) return { problem: "A session is for robinhood or kalshi." };
    args.broker = body.broker;
  }
  if (body.kind === "sell") {
    if (!POSITION.test(String(body.positionId))) return { problem: "Sell needs a position." };
    args.positionId = body.positionId;
    if (body.quantity != null) {
      if (!(Number(body.quantity) > 0)) return { problem: "The quantity must be above 0." };
      args.quantity = Number(body.quantity);
    }
  }
  return { request: { id: body.id.toLowerCase(), kind: body.kind, args } };
}

const say = (r, a) => r.kind === "sell" ? `sell ${a.quantity ?? "all of"} ${a.positionId?.split(":")[1]}` : r.kind === "session" ? `run a ${a.broker === "kalshi" ? "Kalshi" : "stock"} session` : r.kind;

// One pass in live Richie. exec: { mode, owner, adapters, paused }; readers: live quote readers; start(broker):
// starts a session and returns its message; notify(text): Telegram. Returns what was done.
export async function runControls({ inbox, ledger, exec, readers, start, notify = async () => {}, now = Date.now }) {
  const done = [];
  for (const r of inbox.running()) inbox.finish(r.id, "refused", "Interrupted by a restart while running. Check the orders and positions before trying again.", now());
  for (const r of inbox.pending()) {
    if (!inbox.claim(r.id)) continue;
    const a = JSON.parse(r.args);
    let status = "done", result;
    try {
      if (now() - r.at > MAX_AGE_MS) { status = "refused"; result = "Expired: older than 60 seconds, not run."; }
      else if (r.kind === "pause") { ledger.meta("paused", "1"); result = "Paused new buys. Exits and stop checks keep running."; }
      else if (r.kind === "resume") { ledger.meta("paused", "0"); result = "Resumed. New buys allowed again under the usual checks."; }
      else if (r.kind === "session") result = await start(a.broker);
      else if (r.kind === "sell") ({ status, result } = await sell(a, { ledger, exec, readers, now }));
      else { status = "refused"; result = "Unknown control."; }
    } catch (error) { status = "refused"; result = `Error: ${String(error.message).slice(0, 200)}`; }
    inbox.finish(r.id, status, result, now());
    const text = `Dashboard (${say(r, a)}): ${result}`;
    ledger.event({ at: now(), kind: "control", text });
    await notify(text).catch(() => {});
    done.push({ id: r.id, status, result });
  }
  return done;
}

// Sell now: the same order a stop exit sends (stocks at market, Kalshi immediate-or-cancel at the bid), at a live quote.
async function sell(a, { ledger, exec, readers, now }) {
  const p = ledger.position(a.positionId);
  if (!p || p.status !== "open") return { status: "refused", result: "That position is not open." };
  const quantity = a.quantity ?? p.quantity;
  if (quantity > p.quantity + 1e-9) return { status: "refused", result: `Only ${p.quantity} held; not selling ${quantity}.` };
  if (ledger.pendingFor(p.broker, p.instrument, "sell")) return { status: "refused", result: "An earlier sell is not reconciled yet; no second sell." };
  const q = (await readers[p.broker].quotes([p])).find(x => x.instrument === p.instrument);
  const price = p.broker === "kalshi" ? q?.bid : q?.price;
  if (!(price > 0)) return { status: "refused", result: "No live price to sell at right now." };
  const order = { broker: p.broker, instrument: p.instrument, instrumentType: p.instrument_type, side: "sell", outcomeSide: p.broker === "kalshi" ? p.side : undefined,
    quantity, limitPrice: price, orderType: p.broker === "robinhood" ? "market" : "limit", plan: { why: "sold from the dashboard", signalPrice: price } };
  const { submitOrder } = await import("./execution.mjs");   // loaded only in live Richie, never by the dashboard server
  const r = await submitOrder({ ledger, adapter: exec.adapters[p.broker], order, mode: exec.mode, owner: exec.owner, paused: exec.paused, now });
  const at = p.broker === "kalshi" ? `${Math.round(price * 100)}¢` : `$${price}`;
  return r.state === "blocked" ? { status: "refused", result: `Not sent: ${r.reason}` }
    : { status: "done", result: `Sell of ${quantity} ${p.instrument} near ${at}: ${r.state}.` };
}
