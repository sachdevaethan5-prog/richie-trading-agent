// The dashboard's read-only data contract, version richie-dashboard/1. Built only from the
// ledger: the browser never talks to a broker and never receives a key. Every broker-derived value carries its
// source, asOf and a freshness of live, stale, unavailable or sample. A value that could not be read is null with
// that freshness, never zero. Field names are documented in README.md ("Data contract").
import { SETTINGS } from "./config.mjs";
import { freshness } from "./health.mjs";
import { protectionState } from "./monitor.mjs";

export const CONTRACT = "richie-dashboard/1";
const F = SETTINGS.freshness;
const quoteAge = type => type === "crypto" ? F.cryptoQuoteMs : type === "event_contract" ? F.kalshiQuoteMs : F.quoteMs;
const parse = s => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

function account(a, now) {
  const state = freshness({ asOf: a.as_of, lastErrorAt: a.last_error_at, sample: Boolean(a.sample) }, F.accountMs, now);
  const show = state !== "unavailable";
  return { broker: a.broker, accountRef: a.account_ref ? `…${String(a.account_ref).slice(-4)}` : null, currency: a.currency || "USD",
    cash: show ? a.cash : null, buyingPower: show ? a.buying_power : null, value: show ? a.value : null,
    source: a.source, asOf: a.as_of ?? null, freshness: state, lastErrorClass: a.error_class ?? null };
}

function position(L, p, now) {
  const q = L.quote(p.broker, p.instrument);
  const qState = q ? freshness({ asOf: q.as_of, lastErrorAt: q.last_error_at, sample: Boolean(q.sample) }, quoteAge(p.instrument_type), now) : "unavailable";
  // Kalshi positions are valued at the bid of the held side: what an exit would get now.
  const mark = q && qState !== "unavailable" ? (p.broker === "kalshi" ? q.bid : q.price) : null;
  const value = Number.isFinite(mark) ? mark * p.quantity : null;
  const unrealized = value != null && p.cost_basis != null ? value - p.cost_basis : null;
  const orders = L.all("SELECT * FROM orders WHERE broker = ? AND instrument = ? ORDER BY created_at DESC LIMIT 20", p.broker, p.instrument);
  return { id: p.id, instrument: p.instrument, name: p.name, instrumentType: p.instrument_type, broker: p.broker, side: p.side,
    quantity: p.quantity, costBasis: p.cost_basis, basisStatus: p.basis_status, averageEntry: p.cost_basis != null && p.quantity > 0 ? p.cost_basis / p.quantity : null,
    quote: q ? { price: q.price, bid: q.bid, ask: q.ask, depth: parse(q.depth), source: q.source, asOf: q.as_of, freshness: qState } : { freshness: "unavailable" },
    marketValue: value, unrealizedPnl: unrealized, realizedPnl: p.realized_pnl, fees: p.fees, openedAt: p.opened_at, resolutionAt: p.resolution_at,
    orderState: orders[0]?.state ?? null, plan: parse(p.plan), protection: protectionState(p, now), evidenceId: p.evidence_id, sample: Boolean(p.sample) };
}

const order = o => ({ clientId: o.client_id, brokerId: o.broker_id, broker: o.broker, instrument: o.instrument, instrumentType: o.instrument_type, side: o.side,
  outcomeSide: o.outcome_side, requestedQty: o.requested_qty, limitPrice: o.limit_price, notional: o.notional, filledQty: o.filled_qty, avgPrice: o.avg_price,
  fees: o.fees, state: o.state, reason: o.reason, createdAt: o.created_at, submittedAt: o.submitted_at, updatedAt: o.updated_at, sample: Boolean(o.sample) });

const evidence = (e, now) => { const p = parse(e.packet) || {}; return { id: e.id, subject: e.subject, role: e.role, verdict: e.verdict, status: e.status,
  strategyVersion: e.strategy_version, createdAt: e.created_at, expiresAt: e.expires_at, expired: e.expires_at != null && e.expires_at < now, question: p.question ?? null,
  items: p.items || [], countercase: p.countercase ?? null, assumptions: p.assumptions || [], risks: p.risks || [], wouldChange: p.wouldChange ?? null,
  estimates: p.estimates ?? null, problems: p.problems || [], sample: Boolean(e.sample) }; };

// Everything Richie did, newest first: the events log (sessions, orders, commands, chat, imported history), plus
// alerts and closed trades, which are recorded elsewhere.
function timeline(L) {
  const rows = L.events(300).map(e => ({ at: e.at, kind: e.kind, broker: e.broker, subject: e.subject, text: e.text, source: e.source }));
  for (const a of L.alerts(false).slice(0, 100)) rows.push({ at: a.at, kind: a.severity === "important" ? "alert" : "note", broker: null, subject: a.subject, text: a.text, source: "live" });
  for (const t of [...L.trades(false), ...L.trades(true)]) if (t.closed_at) rows.push({ at: t.closed_at, kind: t.paper ? "paper trade" : "closed trade", broker: t.broker, subject: t.instrument,
    text: `${t.paper ? "Paper" : "Closed"} ${t.instrument}: ${t.why || "closed"}${Number.isFinite(t.ret) ? `, ${(t.ret * 100).toFixed(1)}%` : ""}.`, source: t.source || "live" });
  return rows.filter(r => Number.isFinite(r.at)).sort((a, b) => b.at - a.at).slice(0, 400);
}

export function snapshot(L, { now = Date.now(), mode, strategy } = {}) {
  const positions = L.positions("open").map(p => position(L, p, now));
  const health = L.health().map(h => ({ component: h.component, status: h.status, lastOkAt: h.last_ok_at, lastErrorAt: h.last_error_at, lastErrorClass: h.error_class, detail: h.detail,
    dataAgeMs: h.last_ok_at ? now - h.last_ok_at : null }));
  const jobs = L.jobs().map(j => ({ name: j.name, intervalMs: j.interval_ms, lastStartedAt: j.last_started_at, lastOkAt: j.last_ok_at, lastErrorClass: j.error_class,
    nextDueAt: j.last_started_at ? j.last_started_at + j.interval_ms : now, late: j.late }));
  return {
    contract: CONTRACT, generatedAt: now, sample: L.meta("sample") === "1", executionMode: mode, paused: L.meta("paused") === "1",
    accounts: L.accounts().map(a => account(a, now)),
    positions, closedPositions: L.positions("closed").map(p => position(L, p, now)),
    orders: L.all("SELECT * FROM orders ORDER BY created_at DESC LIMIT 100").map(order),
    fills: L.all("SELECT f.*, o.instrument, o.broker, o.side FROM fills f JOIN orders o USING (client_id) ORDER BY f.at DESC LIMIT 100")
      .map(f => ({ clientId: f.client_id, broker: f.broker, instrument: f.instrument, side: f.side, qty: f.qty, price: f.price, fee: f.fee, at: f.at })),
    alerts: L.alerts().map(a => ({ id: a.id, kind: a.kind, severity: a.severity, subject: a.subject, text: a.text, at: a.at })),
    notifications: L.notifications().map(n => ({ kind: n.kind, text: n.text, status: n.status, attempts: n.attempts, errorClass: n.error_class, createdAt: n.created_at, deliveredAt: n.delivered_at })),
    research: L.evidence().map(e => evidence(e, now)),
    trades: { live: L.trades(false), paper: L.trades(true) },
    timeline: timeline(L),
    strategy: strategy ?? null,
    health, jobs,
  };
}

export function positionDetail(L, id, { now = Date.now() } = {}) {
  const p = L.position(id);
  if (!p) return null;
  const out = position(L, p, now);
  out.orders = L.all("SELECT * FROM orders WHERE broker = ? AND instrument = ? ORDER BY created_at DESC", p.broker, p.instrument).map(order);
  out.fills = L.all("SELECT f.* FROM fills f JOIN orders o USING (client_id) WHERE o.broker = ? AND o.instrument = ? ORDER BY f.at", p.broker, p.instrument)
    .map(f => ({ clientId: f.client_id, qty: f.qty, price: f.price, fee: f.fee, at: f.at }));
  out.evidence = (p.evidence_id ? [L.get("SELECT * FROM evidence WHERE id = ?", p.evidence_id)].filter(Boolean) : []).concat(L.evidenceFor(p.instrument).filter(e => e.id !== p.evidence_id)).map(e => evidence(e, now));
  out.ticks = parse(L.meta(`ticks:${p.id}`)) || [];  // live price points from the monitor, oldest first
  out.candles = parse(L.meta(`candles:${p.id}`));   // only what a source supplied; null means no chart data
  out.forecast = parse(L.meta(`forecast:${p.id}`)); // only a forecast with method, horizon, version and time; null means "No current forecast"
  return out;
}
