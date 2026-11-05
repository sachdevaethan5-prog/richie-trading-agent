#!/usr/bin/env node
// Watch-only mode: try Richie safely before letting him trade. It reads balances, positions, order states and quotes
// from both brokers into the ledger, runs the monitor and reconcile on their own lanes, and previews what it would
// do. It never trades: EXECUTION_MODE stays "observe", the Robinhood and Kalshi handles it holds refuse every
// non-read call, and exits go through submitOrder(), which returns "blocked" in observation.
//   node src/runner.mjs [--ledger FILE] [--once] [--telegram]
//   --once      run every job once, print a summary, exit (first runs by hand)
//   --telegram  send important alerts through Richie's bot, send-only; it never reads updates
import { appendFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { LEDGER_FILE, LOG_FILE, secret } from "./env.mjs";
import { SETTINGS, EXECUTION_MODE, DECIDED } from "./config.mjs";
import { openLedger, positionId, TERMINAL } from "./ledger.mjs";
import { scheduler, monitorTick } from "./monitor.mjs";
import { submitOrder, reconcile, unspentAccount, cents } from "./execution.mjs";
import { errorClass } from "./health.mjs";
import { notifyDecision, orderMessage } from "./voice.mjs";
import { robinhoodAdapter, kalshiAdapter } from "./adapters/brokers.mjs";
import { robinhoodReader, kalshiReader, readOnlyRobinhood, readOnlyKalshi } from "./adapters/readers.mjs";

const MIN = 60000;
const isStock = p => p.broker === "robinhood" && p.instrument_type !== "crypto";

import { EARLY_CLOSE, marketOpen } from "./hours.mjs";
export { HOLIDAYS, EARLY_CLOSE, marketOpen } from "./hours.mjs";

async function readAccount(ledger, reader, now) {
  try { ledger.setAccount(await reader.account()); ledger.healthOk(`account:${reader.broker}`, now()); }
  catch (error) { ledger.accountError(reader.broker, errorClass(error), now()); ledger.healthError(`account:${reader.broker}`, errorClass(error), now(), String(error.message).slice(0, 160)); throw error; }
}

// One monitor lane. In observation an exit signal becomes a preview: submitOrder() returns "blocked" with the order
// it would have sent, kept as one alert per position until the signal clears. Live (exec.mode "live", the execution
// lease held) the exit is sent like the legacy watcher's: a market sell of the whole position (Kalshi: an
// immediate-or-cancel sell at the bid), once; an unresolved earlier sell blocks a second one until reconcile.
async function watch({ ledger, name, filter, reader, now, exec = null }) {
  const { exits } = await monitorTick({ ledger, name, filter, now, quotes: async open => { const rows = await reader.quotes(open); recordTicks(ledger, open, rows); return rows; } });
  const signalled = new Set(), live = exec?.mode === "live";
  for (const x of exits) {
    const p = x.position;
    signalled.add(p.id);
    const order = { broker: p.broker, instrument: p.instrument, instrumentType: p.instrument_type, side: "sell", outcomeSide: p.broker === "kalshi" ? p.side : undefined,
      quantity: p.quantity, limitPrice: x.price, orderType: p.broker === "robinhood" ? "market" : "limit", plan: { why: x.why, signalPrice: x.price } };
    const price = p.broker === "kalshi" ? `${Math.round(x.price * 100)}¢` : `$${x.price}`;
    if (!live) {
      const result = await submitOrder({ ledger, adapter: null, order, mode: EXECUTION_MODE, now });
      if (result.state !== "blocked") throw Error(`Observation runner reached a broker (${result.state}); stopping`);   // cannot happen in observe mode
      ledger.alert({ kind: "exit_preview", severity: "important", subject: p.instrument, at: now(), dedupe: `exit_preview:${p.id}`,
        text: `Watch-only: the ${x.why} on ${p.instrument} was hit at ${price}. Richie's rebuild would sell ${p.quantity}; nothing was sent.` });
      continue;
    }
    if (ledger.pendingFor(p.broker, p.instrument, "sell")) continue;   // already sent; reconcile reports the outcome
    const result = await submitOrder({ ledger, adapter: exec.adapters[p.broker], order, mode: "live", owner: exec.owner, paused: exec.paused, now });
    if (result.state === "blocked") ledger.alert({ kind: "exit_blocked", severity: "important", subject: p.instrument, at: now(), dedupe: `exit_blocked:${p.id}`,
      text: `The ${x.why} on ${p.instrument} was hit at ${price}, but the sell was not sent: ${result.reason}` });
    else ledger.resolveAlert(`exit_blocked:${p.id}`, now());
  }
  for (const p of ledger.positions("open").filter(filter)) if (!signalled.has(p.id)) { ledger.resolveAlert(`exit_preview:${p.id}`, now()); ledger.resolveAlert(`exit_blocked:${p.id}`, now()); }
}

// Each monitor read is kept as a price point for the position's live chart: the last 600 (about a trading day of
// minutes), the price an exit would get (Kalshi: the bid of the held side).
export function recordTicks(ledger, positions, rows, keep = 600) {
  for (const p of positions) {
    const q = rows.find(r => r.broker === p.broker && r.instrument === p.instrument);
    const price = q ? (p.broker === "kalshi" ? q.bid : q.price) : null;
    if (!Number.isFinite(price)) continue;
    let ticks = []; try { ticks = JSON.parse(ledger.meta(`ticks:${p.id}`) || "[]"); } catch { ticks = []; }
    if (ticks.at(-1)?.t === q.asOf) continue;
    ticks.push({ t: q.asOf, p: price });
    ledger.meta(`ticks:${p.id}`, JSON.stringify(ticks.slice(-keep)));
  }
}

// The old playbook's two other exits, in code (they were left to sessions): near the close (from 10 minutes before it,
// once a day) a satellite whose price is under its 20-day average exits, and one opened under that playbook exits
// after 20 trading days. Core holdings and trailing-stop satellites (playbook core-trail-1) are exempt; the time
// limit does not apply to positions the legacy bot bought.
export function closeRuleExit(p, price, bars, now) {
  let plan = {}; try { plan = JSON.parse(p.plan || "{}"); } catch {}
  if (plan.role === "core" || plan.trail || !Number.isFinite(price) || p.broker !== "robinhood" || p.instrument_type === "crypto") return null;
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const past = bars.filter(b => new Date(b.t).toLocaleDateString("en-CA", { timeZone: "America/New_York" }) < today);
  if (past.length >= 19 && price < (past.slice(-19).reduce((t, b) => t + b.c, 0) + price) / 20) return "close under the 20-day average";
  if (plan.source !== "legacy case" && Number.isFinite(p.opened_at) && past.filter(b => b.t > p.opened_at).length + 1 >= 20) return "20 trading days";
  return null;
}
// A trailing stop (playbook core-trail-1) follows the highest close since entry: once a day near the close, the price
// then (the day's close, near enough) raises the high, and the stop rises to trail under it. It never falls. The
// monitor sells at the stop like any other. Returns the new plan, or null when nothing moved.
export function trailPlan(plan, price) {
  if (!(plan?.trail > 0) || !Number.isFinite(price)) return null;
  const high = Math.max(Number(plan.high) || 0, price), stop = Math.max(Number(plan.stop) || 0, cents(high * (1 - plan.trail)));
  return high === plan.high && stop === plan.stop ? null : { ...plan, high, stop };
}

export async function closeRules({ ledger, exec, now = Date.now, open = marketOpen }) {
  const e = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", year: "numeric", month: "2-digit", day: "2-digit", hourCycle: "h23" }).formatToParts(now()).map(x => [x.type, x.value]));
  const day = `${e.year}-${e.month}-${e.day}`, m = Number(e.hour) * 60 + Number(e.minute), closeAt = (EARLY_CLOSE.has(day) ? 13 : 16) * 60;
  if (!open(now()) || m < closeAt - 10) return [];
  // Each position is checked once a day, marked only once it was really decided: a stale quote or a failed send is
  // tried again on the next pass (this ran every minute until the close; a whole-day marker lost those exits).
  let done = {}; try { done = JSON.parse(ledger.meta("close_rules_done") || "{}"); } catch {}
  if (done.day !== day) done = { day, ids: [] };
  const mark = id => { done.ids.push(id); ledger.meta("close_rules_done", JSON.stringify(done)); };
  const sent = [];
  for (const p of ledger.positions("open").filter(isStock)) {
    if (done.ids.includes(p.id)) continue;
    // Only a price from the last few minutes decides the close rule; an old one (a failed quote read) is no signal.
    const q = ledger.quote(p.broker, p.instrument), bars = JSON.parse(ledger.meta(`candles:${p.id}`) || "{}").bars || [];
    if (now() - (q?.as_of ?? 0) > 5 * MIN) continue;
    let plan = {}; try { plan = JSON.parse(p.plan || "{}"); } catch {}
    const trailed = trailPlan(plan, q.price);
    if (trailed) {
      ledger.run("UPDATE positions SET plan = ? WHERE id = ?", JSON.stringify(trailed), p.id);
      if (trailed.stop !== plan.stop) ledger.event({ at: now(), kind: "exit", broker: p.broker, subject: p.instrument, text: `${p.instrument}: trailing stop raised to $${trailed.stop} (high $${trailed.high}).` });
    }
    const why = closeRuleExit(p, q?.price, bars, now());
    if (!why || ledger.pendingFor(p.broker, p.instrument, "sell")) { mark(p.id); continue; }
    const order = { broker: p.broker, instrument: p.instrument, instrumentType: p.instrument_type, side: "sell", quantity: p.quantity, limitPrice: q.price, orderType: "market", plan: { why, signalPrice: q.price } };
    // A throw leaves the position unmarked; the durable intent and the unresolved-order block stop a second sale.
    const result = exec?.mode === "live" ? await submitOrder({ ledger, adapter: exec.adapters[p.broker], order, mode: "live", owner: exec.owner, paused: exec.paused, now }) : { state: "blocked", reason: "observation" };
    mark(p.id);
    ledger.event({ at: now(), kind: "exit", broker: p.broker, subject: p.instrument, text: `${p.instrument}: ${why} at $${q.price}. ${result.state === "blocked" ? `Not sent: ${result.reason}` : `Sell ${result.state}.`}` });
    sent.push({ instrument: p.instrument, why, state: result.state });
  }
  return sent;
}

// The core (DECIDED.stocks): cash goes to SPY until SPY is coreShare of the Robinhood account,
// capped by the cash. That leaves the other part for satellites: cash from a satellite's exit refills the satellite
// money first, and only what is over it goes to the core. Code never sells the core to fund or rebalance. Under
// Robinhood's $1 minimum, nothing is bought. account: unspent cash and the account value; coreValue: SPY held now.
export function coreBuyAmount({ account, coreValue, s = DECIDED.stocks }) {
  if (!Number.isFinite(account?.cash) || !Number.isFinite(account?.value) || !Number.isFinite(coreValue)) return 0;
  const amount = cents(Math.min(account.cash, s.coreShare * account.value - coreValue));
  return amount >= s.minOrder ? amount : 0;
}
// Off after the owner sells the core or sends "core off", until "core on". Live only, in market hours from 10:00 to 3:45 Eastern (not into the opening spreads or the close), never while any
// Robinhood order is unresolved, and only on a fresh SPY price when SPY is already held. A notional market buy.
export async function coreKeeper({ ledger, exec, now = Date.now, open = marketOpen, s = DECIDED.stocks }) {
  if (exec?.mode !== "live" || ledger.meta("core") === "off" || !open(now())) return null;
  const e = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now()).map(x => [x.type, x.value]));
  const m = Number(e.hour) * 60 + Number(e.minute);
  if (m < 10 * 60 || m > 15 * 60 + 45) return null;
  const unresolved = ledger.all(`SELECT client_id FROM orders WHERE broker = 'robinhood' AND state NOT IN (${[...TERMINAL].map(() => "?").join(",")})`, ...TERMINAL);
  if (unresolved.length) return null;
  const held = ledger.position(positionId("robinhood", s.core, "long")), q = ledger.quote("robinhood", s.core);
  const holding = held?.status === "open" && held.quantity > 0;
  if (holding && !(now() - (q?.as_of ?? 0) <= 5 * MIN && q?.price > 0)) return null;
  const order = { broker: "robinhood", instrument: s.core, instrumentType: "etf", side: "buy", orderType: "market",
    plan: { role: "core", source: "core keeper", why: `cash to the ${s.core} core` } };
  const amount = coreBuyAmount({ account: unspentAccount(ledger, order), coreValue: holding ? held.quantity * q.price : 0, s });
  if (!amount) return null;
  const result = await submitOrder({ ledger, adapter: exec.adapters.robinhood, order: { ...order, notional: amount }, mode: "live", owner: exec.owner, paused: exec.paused, now });
  ledger.event({ at: now(), kind: "order", broker: "robinhood", subject: s.core, text: `Core: buy $${amount.toFixed(2)} of ${s.core}. ${result.state === "blocked" ? `Not sent: ${result.reason}` : `Order ${result.state}.`}` });
  return { amount, state: result.state };
}

// Daily bars for the position drawer's chart (stocks and ETFs; Robinhood gives no crypto bars through this tool).
async function candles({ ledger, reader, now }) {
  for (const p of ledger.positions("open").filter(isStock)) {
    const bars = await reader.dailyBars(p.instrument, 60);
    if (bars.length) ledger.meta(`candles:${p.id}`, JSON.stringify({ interval: "1d", source: "robinhood get_equity_historicals", asOf: now(), sample: false, bars }));
  }
}

// Important alerts not yet sent go to Telegram, at most 5 a pass; the rest wait on the dashboard. Without a
// Telegram client the marker still moves, so turning Telegram on later does not replay old alerts.
async function notifyAlerts({ ledger, telegram, prefix = "Watch-only: " }) {
  const last = Number(ledger.meta("notified_alert_id") || 0);
  const fresh = ledger.all("SELECT * FROM alerts WHERE id > ? AND resolved_at IS NULL ORDER BY id", last).filter(a => notifyDecision({ kind: "alert", severity: a.severity }) === "send");
  const top = ledger.get("SELECT MAX(id) AS id FROM alerts")?.id ?? last;
  if (telegram) {
    for (const a of fresh.slice(0, 5)) await telegram.send(a.text.startsWith("Watch-only") ? a.text : `${prefix}${a.text}`, "alert");
    for (const a of fresh.filter(a => ["settled", "report", "review"].includes(a.kind))) ledger.resolveAlert(a.dedupe, Date.now());   // news, not an open problem
    if (fresh.length > 5) await telegram.send(`${prefix}${fresh.length - 5} more alerts are on the dashboard.`, "alert");
  }
  ledger.meta("notified_alert_id", top);
}

// Every order state change since the last pass goes to Telegram as the code-built message (voice.mjs).
async function notifyOrders({ ledger, telegram }) {
  const since = Number(ledger.meta("orders_notified_at") || 0);
  const rows = ledger.all("SELECT * FROM orders WHERE updated_at > ? ORDER BY updated_at", since);
  for (const o of rows) {
    const text = orderMessage(o);
    if (text) ledger.event({ at: o.updated_at, kind: "order", broker: o.broker, subject: o.instrument, text, dedupe: `order:${o.client_id}:${o.state}` });
    if (telegram && text && notifyDecision({ kind: "order", state: o.state }) === "send") await telegram.send(text, "order");
  }
  if (rows.length) ledger.meta("orders_notified_at", rows.at(-1).updated_at);
}

// The ledger is the record of every order, fill and trade: a consistent copy each day, the last 14 kept.
export async function backupLedger(ledger, dir, now = Date.now()) {
  const { mkdir, readdir, rm } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  const day = new Date(now).toLocaleDateString("en-CA", { timeZone: "America/New_York" }), file = join(dir, `ledger-${day}.db`);
  await rm(file, { force: true });
  ledger.db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const old = (await readdir(dir)).filter(f => /^ledger-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort().slice(0, -14);
  for (const f of old) await rm(join(dir, f), { force: true });
  return file;
}

// readers/adapters: { robinhood, kalshi }; either may be missing when that broker could not be reached.
// exec: null for observation, or { mode: "live", owner, adapters, paused } from live.mjs.
export function observerJobs({ ledger, readers, adapters, telegram = null, now = Date.now, open = marketOpen, exec = null, backupDir = null }) {
  const jobs = [];
  for (const b of ["robinhood", "kalshi"]) {
    if (!readers[b]) continue;
    jobs.push({ name: `account:${b}`, lane: "accounts", priority: 2, intervalMs: 2 * MIN, run: () => readAccount(ledger, readers[b], now) });
    // A booked fill changes the cash: read the balance right away, so a buy funded by a sale is not refused for a stale balance.
    jobs.push({ name: `reconcile:${b}`, lane: "reconcile", priority: 3, intervalMs: exec ? MIN : 5 * MIN, run: async () => {
      const r = await reconcile({ ledger, adapter: adapters[b], now });
      if (r.resolved.length || r.settled?.length || r.adopted?.length) await readAccount(ledger, readers[b], now);
    } });
  }
  if (readers.robinhood) {
    jobs.push({ name: "monitor:stocks", lane: "monitor-stocks", priority: 1, intervalMs: SETTINGS.monitorIntervalMs.stock,
      run: () => open(now()) ? watch({ ledger, name: "monitor:stocks", filter: isStock, reader: readers.robinhood, now, exec }) : null });
    jobs.push({ name: "monitor:crypto", lane: "monitor-crypto", priority: 1, intervalMs: SETTINGS.monitorIntervalMs.crypto,
      run: () => watch({ ledger, name: "monitor:crypto", filter: p => p.broker === "robinhood" && p.instrument_type === "crypto", reader: readers.robinhood, now, exec }) });
    jobs.push({ name: "candles", lane: "background", priority: 5, intervalMs: 60 * MIN, run: () => candles({ ledger, reader: readers.robinhood, now }) });
    if (exec) jobs.push({ name: "close rules", lane: "monitor-stocks", priority: 2, intervalMs: MIN, run: () => closeRules({ ledger, exec, now, open }) });
    if (exec) jobs.push({ name: "core", lane: "monitor-stocks", priority: 3, intervalMs: 15 * MIN, run: () => coreKeeper({ ledger, exec, now, open }) });
  }
  if (readers.kalshi) jobs.push({ name: "monitor:kalshi", lane: "monitor-kalshi", priority: 1, intervalMs: SETTINGS.monitorIntervalMs.event_contract,
    run: () => watch({ ledger, name: "monitor:kalshi", filter: p => p.broker === "kalshi", reader: readers.kalshi, now, exec }) });
  if (backupDir) jobs.push({ name: "backup", lane: "background", priority: 9, intervalMs: 6 * 60 * MIN, run: () => backupLedger(ledger, backupDir, now()) });
  jobs.push({ name: "notify", lane: "notify", priority: 4, intervalMs: MIN, run: async () => { await notifyOrders({ ledger, telegram }); await notifyAlerts({ ledger, telegram, prefix: exec ? "" : "Watch-only: " }); } });
  return jobs;
}

// Robinhood can refuse sign-ins for minutes at a time overnight, so its jobs are always defined and each one first
// makes sure the account is known; a failure is that job's error and the next run tries again.
export function robinhoodParts({ rh, ledger, log, agenticAccount }) {
  const account = {};
  const ready = async () => {
    if (account.account_number) return;
    try {
      const found = agenticAccount(await rh.call("get_accounts", {}));
      if (!found) throw Error("Robinhood shows no agentic account");
      Object.assign(account, found);
    } catch (error) { ledger.healthError("broker_sync:robinhood", errorClass(error), Date.now(), String(error.message).slice(0, 160)); await log({ event: "connect_error", broker: "robinhood", error: error.message }); throw error; }
  };
  const afterReady = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "function" ? async (...a) => { await ready(); return v(...a); } : v]));
  return { account, ready, reader: afterReady(robinhoodReader(rh, account)), adapter: afterReady(robinhoodAdapter(rh, account)) };
}

// One Robinhood connection, rebuilt on the next call after any failure (an expired MCP session answers with an
// error, not a 401). Each rebuild refreshes under the shared lock.
export function lazyConnection(open) {
  let live = null;
  return { call: async (name, args) => {
    live ??= open();
    try { return await (await live).call(name, args); } catch (error) { live = null; throw error; }
  } };
}

async function main() {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const file = arg("--ledger") || LEDGER_FILE;
  if (EXECUTION_MODE !== "observe") throw Error("The runner only runs in observation mode");
  await mkdir(dirname(file), { recursive: true });
  await mkdir(dirname(LOG_FILE), { recursive: true });
  const log = e => appendFile(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), ...e }) + "\n").catch(() => {});
  const ledger = openLedger(file);
  const [{ runnerConnect }, { connect: kalshiConnect }, { agenticAccount, toolKind }] = await Promise.all([import("./signin.mjs"), import("./core/kalshi.mjs"), import("./core/lib.mjs")]);
  const readers = {}, adapters = {};
  const parts = robinhoodParts({ rh: readOnlyRobinhood(lazyConnection(() => runnerConnect({ log, readOnly: n => toolKind(n) === "read" }))), ledger, log, agenticAccount });
  readers.robinhood = parts.reader; adapters.robinhood = parts.adapter;
  try {
    const ks = readOnlyKalshi(await kalshiConnect());
    readers.kalshi = kalshiReader(ks); adapters.kalshi = kalshiAdapter(ks);
  } catch (error) { ledger.healthError("broker_sync:kalshi", errorClass(error), Date.now(), String(error.message).slice(0, 160)); await log({ event: "connect_error", broker: "kalshi", error: error.message }); }
  let telegram = null;
  if (args.includes("--telegram")) {
    const { telegramClient, telegramTransport } = await import("./telegram.mjs");
    const [token, chatId] = await Promise.all([secret("telegram-token"), secret("telegram-chat-id")]);
    telegram = telegramClient({ call: telegramTransport({ token }), chatId, ledger });
  }
  const jobs = observerJobs({ ledger, readers, adapters, telegram }).map(j => ({ ...j, run: () => Promise.resolve(j.run()).catch(async error => { await log({ event: "job_error", job: j.name, error: error.message }); throw error; }) }));
  const sched = scheduler({ ledger, jobs });
  await log({ event: "start", once: args.includes("--once"), telegram: Boolean(telegram), brokers: Object.keys(readers) });
  if (args.includes("--once")) {
    await Promise.all(sched.tick());   // every job is due on a fresh run; each lane runs its jobs in order
    const s = { accounts: ledger.accounts().map(a => ({ broker: a.broker, cash: a.cash, value: a.value, error: a.error_class })), open: ledger.positions("open").length,
      alerts: ledger.alerts().map(a => `${a.kind}: ${a.text}`), jobs: ledger.jobs().map(j => `${j.name} ${j.last_error_at && (!j.last_ok_at || j.last_error_at > j.last_ok_at) ? `error ${j.error_class}` : "ok"}`) };
    console.log(JSON.stringify(s, null, 2));
    ledger.close();
    return;
  }
  setInterval(() => sched.tick(), 15000);
  sched.tick();
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });
