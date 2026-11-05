// Position monitoring in plain code. The legacy scheduler skipped stop checks whenever a model
// session or chat held the one work lock. Here work runs in lanes: the monitor lane never waits on the research
// or chat lane, and every state change is its own ledger transaction, so no lane can undo another's write.
import { SETTINGS } from "./config.mjs";
import { errorClass } from "./health.mjs";
import { marketOpen } from "./hours.mjs";

const maxAge = type => type === "crypto" ? SETTINGS.freshness.cryptoQuoteMs : type === "event_contract" ? SETTINGS.freshness.kalshiQuoteMs : SETTINGS.freshness.quoteMs;
const planOf = p => { try { return p.plan ? JSON.parse(p.plan) : {}; } catch { return {}; } };
// A level the plan does not set is no level. Number(null) is 0, which read "target: null" as a target of 0 and sold the
// first Kalshi bet two minutes after it filled (2026-11-02, KXNYCSUBWAY NO bought at 93c, sold at 91c "on target").
const level = v => v == null || v === "" ? NaN : Number(v);

// What protects a position right now, stated plainly. "watched" means Richie's own process checked it within two
// intervals; it is never called broker protection, and it lapses the moment checks stop.
// A Kalshi bet whose plan sets no stop or target is held to settlement by design (its loss is the stake), and a stock
// is only watched in market hours: neither is an alarm (both were raised as one on 2026-11-02).
export function protectionState(p, now = Date.now(), { open = marketOpen } = {}) {
  const plan = planOf(p), base = { mode: p.protection_mode, lastOkAt: p.protection_last_ok_at ?? null, intervalMs: p.protection_interval_ms ?? null };
  const isStock = p.broker === "robinhood" && p.instrument_type !== "crypto";
  if (p.protection_mode === "broker_native") return p.protection_verified ? { ...base, state: "broker", note: "Broker-native order, verified." }
    : { ...base, state: "degraded", note: "A broker-native order is assumed but not verified." };
  if (plan.role === "core") return { ...base, state: "core", note: "Core holding (SPY): held long term with no stop, by the playbook." };
  if (p.protection_mode !== "richie_watcher") return { ...base, state: "unprotected", note: "No exit is being watched." };
  if (!Number.isFinite(level(plan.stop))) return p.broker === "kalshi" && !Number.isFinite(level(plan.target))
    ? { ...base, state: "settlement", note: "Held to settlement: the plan sets no stop or target, so the most it can lose is what it cost." }
    : { ...base, state: "unprotected", note: "Watched, but the plan has no stop level." };
  const fresh = Number.isFinite(p.protection_last_ok_at) && now - p.protection_last_ok_at <= 2 * (p.protection_interval_ms || 0);
  if (fresh) return { ...base, state: "watched", note: "Richie's watcher, not a broker order. It stops if Richie's process stops." };
  return isStock && !open(now) ? { ...base, state: "market closed", note: "The stock market is closed; Richie's watcher checks the stop again at the open." }
    : { ...base, state: "degraded", note: "Richie's watcher has not completed a check recently." };
}

// The price an exit would get: the bid of the held side for Kalshi, last price otherwise.
const markOf = (p, q) => p.broker === "kalshi" ? q.bid : q.price;
export function exitSignal(p, q) {
  if (q.status && q.status !== "active") return null;   // a closed or decided Kalshi market settles; there is no book to sell into
  const plan = planOf(p), price = markOf(p, q);
  if (!Number.isFinite(price)) return null;
  if (Number.isFinite(level(plan.stop)) && price <= level(plan.stop)) return { why: "stop", price };
  if (Number.isFinite(level(plan.target)) && price >= level(plan.target)) return { why: "target", price };
  return null;
}

// One monitor pass. quotes(positions) returns [{ broker, instrument, price, bid, ask, asOf, source }].
// Returns exit signals; the caller sends them through submitOrder(), which in observation mode only previews.
// filter picks the positions this pass covers (the runner checks stocks, crypto and Kalshi on their own cadences).
export async function monitorTick({ ledger, quotes, now = Date.now, filter = () => true, name = "monitor", marketIsOpen = marketOpen }) {
  const open = ledger.positions("open").filter(filter), at = now(), exits = [];
  if (!open.length) { ledger.healthOk(name, at, "no open positions"); return { exits, checked: 0 }; }
  let rows;
  try { rows = await quotes(open); }
  catch (error) {
    const cls = errorClass(error);
    ledger.tx(() => {
      for (const p of open) ledger.quoteError(p.broker, p.instrument, at);
      ledger.healthError(name, cls, at, "quote read failed");
      ledger.alert({ kind: "monitor_failed", severity: "important", at, dedupe: `${name}_failed`, text: `Position check failed (${cls}). ${open.length} open position${open.length > 1 ? "s are" : " is"} not being watched until quotes return.` });
    });
    return { exits, checked: 0, error: cls };
  }
  ledger.tx(() => {
    for (const p of open) {
      const q = rows.find(r => r.broker === p.broker && r.instrument === p.instrument);
      const key = `stale_quote:${p.id}`;
      if (!q || !Number.isFinite(q.asOf) || at - q.asOf > maxAge(p.instrument_type)) {
        if (q) ledger.setQuote(q); else ledger.quoteError(p.broker, p.instrument, at);
        ledger.alert({ kind: "stale_quote", severity: "important", subject: p.instrument, at, dedupe: key,
          text: `${p.instrument} quote is ${q ? `${Math.round((at - q.asOf) / 60000)} minutes old` : "missing"}. Its exit is not being checked against a current price.` });
        continue;
      }
      ledger.setQuote(q);
      ledger.resolveAlert(key, at);
      ledger.setProtection(p.id, { lastOkAt: at, intervalMs: p.protection_interval_ms || SETTINGS.monitorIntervalMs[p.instrument_type] });
      const signal = exitSignal(p, q);
      if (signal) exits.push({ position: p, ...signal });
    }
    // Anything still not watched after this pass is an important alert, once.
    for (const p of ledger.positions("open").filter(filter)) {
      const s = protectionState(p, at, { open: marketIsOpen }), key = `protection:${p.id}`;
      if (["watched", "broker", "core", "settlement", "market closed"].includes(s.state)) ledger.resolveAlert(key, at);
      else ledger.alert({ kind: "protection", severity: "important", subject: p.instrument, at, dedupe: key, text: `${p.instrument} is ${s.state}: ${s.note}` });
    }
    ledger.resolveAlert(`${name}_failed`, at);
    ledger.healthOk(name, at, `${open.length} checked`);
  });
  return { exits, checked: open.length };
}

// Jobs in lanes. A lane runs its due jobs one at a time by priority; a busy lane is skipped, never waited on.
// Job times live in the ledger, so after a restart an overdue job runs once (not once per missed interval).
export function scheduler({ ledger, jobs, now = Date.now }) {
  const busy = new Set();
  for (const j of jobs) ledger.defineJob(j.name, j.priority, j.intervalMs);
  const due = at => jobs.filter(j => { const r = ledger.job(j.name); return !r.last_started_at || at - r.last_started_at >= j.intervalMs; })
    .sort((a, b) => a.priority - b.priority);
  const runLane = async (lane, list) => {
    busy.add(lane);
    try {
      for (const j of list) {
        const at = now(), r = ledger.job(j.name);
        const late = r.last_started_at && at - r.last_started_at > 2 * j.intervalMs ? 1 : 0;
        ledger.run("UPDATE jobs SET last_started_at = ?, runs = runs + 1, late = late + ? WHERE name = ?", at, late, j.name);
        try { await j.run(); ledger.run("UPDATE jobs SET last_ok_at = ? WHERE name = ?", now(), j.name); }
        catch (error) { ledger.run("UPDATE jobs SET last_error_at = ?, error_class = ? WHERE name = ?", now(), errorClass(error), j.name); }
      }
    } finally { busy.delete(lane); }
  };
  return {
    due,
    busy: lane => busy.has(lane),
    // Starts every idle lane that has due work and returns their promises without awaiting them together.
    tick() {
      const at = now(), byLane = new Map();
      for (const j of due(at)) if (!busy.has(j.lane)) byLane.set(j.lane, [...(byLane.get(j.lane) || []), j]);
      return [...byLane].map(([lane, list]) => runLane(lane, list));
    },
  };
}
