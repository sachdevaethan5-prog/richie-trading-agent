// Richie rebuild: the watch-only runner (src/runner.mjs) and its read-only broker views.
// Offline only: fake Robinhood, Kalshi and Telegram transports; nothing reaches a broker, model or Keychain.
import test from "node:test";
import assert from "node:assert/strict";
import { openLedger } from "../src/ledger.mjs";
import { importLegacy } from "../src/migrate.mjs";
import { scheduler } from "../src/monitor.mjs";
import { robinhoodAdapter, kalshiAdapter } from "../src/adapters/brokers.mjs";
import { robinhoodReader, kalshiReader, readOnlyRobinhood, readOnlyKalshi } from "../src/adapters/readers.mjs";
import { observerJobs, marketOpen, lazyConnection } from "../src/runner.mjs";

const T0 = Date.parse("2026-11-03T15:00:00Z");   // Tuesday 10:00 Eastern
const J = data => JSON.stringify({ data });

function fakeRobinhood({ abbv = 279, btc = 70000, quoteAge = 0, at = T0 } = {}) {
  const calls = [];
  const answers = {
    get_portfolio: () => J({ total_value: "120.50", cash: "40.25" }),
    get_equity_quotes: () => J({ results: [{ quote: { symbol: "ABBV", last_trade_price: String(abbv), bid_price: String(abbv - 0.1), ask_price: String(abbv + 0.1), updated_at: new Date(at - quoteAge).toISOString() } }] }),
    get_crypto_quotes: () => J({ results: [{ symbol: "BTC-USD", mark_price: String(btc), bid_price: String(btc - 5), ask_price: String(btc + 5) }] }),
    get_equity_positions: () => J({ results: [{ symbol: "ABBV", quantity: "0.0141" }] }),
    get_crypto_positions: () => J({ results: [{ currency_code: "BTC", quantity: "0.0001" }] }),
    get_equity_orders: () => J({ results: [] }), get_crypto_orders: () => J({ results: [] }),
    get_equity_historicals: () => J({ results: [{ symbol: "ABBV", bars: [{ begins_at: "2026-11-02T00:00:00Z", open_price: "280", high_price: "283", low_price: "278", close_price: "281", volume: "100" }] }] }),
  };
  return { calls, call: async (name, args) => { calls.push(name); if (!answers[name]) throw Error(`fake has no ${name}`); return answers[name](args); } };
}
function fakeKalshi({ yesBid = 0.55, noBid = 0.4 } = {}) {
  const posts = [];
  return { posts, post: async (...a) => { posts.push(a); return {}; }, get: async path => {
    if (path === "/portfolio/balance") return { balance: 363, portfolio_value: 120 };
    if (path.startsWith("/markets/")) return { market: { ticker: "KXRAIN", last_price_dollars: "0.58", yes_bid_dollars: String(yesBid), yes_ask_dollars: "0.60", no_bid_dollars: String(noBid), no_ask_dollars: "0.45" } };
    if (path.startsWith("/portfolio/positions")) return { market_positions: [{ ticker: "KXRAIN", position_fp: "-3" }] };
    if (path.startsWith("/portfolio/orders")) return { orders: [] };
    throw Error(`fake has no ${path}`);
  } };
}
function seeded() {
  const L = openLedger();
  importLegacy(L, { held: { ABBV: { kind: "stock", quantity: 0.0141, dollars: 4, entry: 283.67, stop: 280, target: 300, at: T0 - 86400000 },
    BTC: { kind: "crypto", quantity: 0.0001, dollars: 7, entry: 69000, stop: 60000, target: 80000 } },
    kalshi: { held: { KXRAIN: { side: "no", dollars: 1.2, entry: 0.4, stop: 0.3, target: 0.7 } } } }, { now: T0 - 1000 });
  return L;
}
const setup = ({ rh = fakeRobinhood(), ks = fakeKalshi(), now = () => T0, telegram = null } = {}) => {
  const L = seeded(), account = { account_number: "ACCT1234" };
  const r = readOnlyRobinhood(rh), k = readOnlyKalshi(ks);
  const jobs = observerJobs({ ledger: L, readers: { robinhood: robinhoodReader(r, account, { now }), kalshi: kalshiReader(k, { now }) },
    adapters: { robinhood: robinhoodAdapter(r, account), kalshi: kalshiAdapter(k) }, telegram, now, open: marketOpen });
  return { L, rh, ks, sched: scheduler({ ledger: L, jobs, now }) };
};

test("the runner's broker handles refuse every write before it leaves the process", async () => {
  const rh = fakeRobinhood(), ks = fakeKalshi();
  await assert.rejects(readOnlyRobinhood(rh).call("place_equity_order", {}), /not a look-only tool/);
  await assert.rejects(readOnlyRobinhood(rh).call("cancel_crypto_order", {}), /not a look-only tool/);
  await assert.rejects(readOnlyKalshi(ks).post("/portfolio/events/orders", {}), /writes are refused/);
  assert.deepEqual([rh.calls, ks.posts], [[], []]);
  assert.match(await readOnlyRobinhood(rh).call("get_portfolio", {}), /cash/);
});

test("one full pass: balances, quotes, reconcile and an exit preview, with no order anywhere", async () => {
  const { L, rh, ks, sched } = setup();
  await Promise.all(sched.tick());
  assert.deepEqual(L.accounts().map(a => [a.broker, a.cash, a.value]), [["kalshi", 3.63, 4.83], ["robinhood", 40.25, 120.5]]);
  // ABBV at 279 is under its 280 stop: a preview, not an order.
  const preview = L.alerts().find(a => a.kind === "exit_preview");
  assert.match(preview.text, /^Watch-only: the stop on ABBV was hit at \$279\. .*nothing was sent\.$/);
  assert.equal(L.all("SELECT COUNT(*) AS n FROM orders WHERE state != 'unknown'")[0].n, 0);
  assert.ok(!rh.calls.some(c => /place|cancel|review|preview/.test(c)), rh.calls.join(","));
  assert.deepEqual(ks.posts, []);
  // The NO holder is valued at the NO bid and its last price is 1 minus YES's.
  const q = L.quote("kalshi", "KXRAIN");
  assert.equal(q.bid, 0.4); assert.ok(Math.abs(q.price - 0.42) < 1e-9);
  assert.equal(L.position("robinhood:ABBV:long").protection_last_ok_at, T0);
  assert.ok(JSON.parse(L.meta("candles:robinhood:ABBV:long")).bars.length === 1);
  // Kalshi count was estimated as 3 from the legacy dollars; the broker agrees, so no mismatch for it.
  assert.ok(!L.alerts().some(a => a.subject === "KXRAIN" && /mismatch|missing|unmatched/.test(a.kind)));
  assert.ok(L.jobs().every(j => !j.last_error_at), JSON.stringify(L.jobs()));
});

test("a stale broker quote is not acted on, and stocks are left alone outside market hours", async () => {
  const stale = setup({ rh: fakeRobinhood({ quoteAge: 3 * 60000 }) });
  await Promise.all(stale.sched.tick());
  assert.ok(stale.L.alerts().some(a => a.kind === "stale_quote" && a.subject === "ABBV"));
  assert.ok(!stale.L.alerts().some(a => a.kind === "exit_preview"));
  const night = Date.parse("2026-11-03T03:00:00Z");   // 22:00 Eastern
  const off = setup({ rh: fakeRobinhood({ at: night }), now: () => night });
  await Promise.all(off.sched.tick());
  assert.ok(!off.rh.calls.includes("get_equity_quotes"));
  assert.ok(off.rh.calls.includes("get_crypto_quotes"));
});

test("important alerts go out once, send-only, marked watch-only", async () => {
  const sent = [];
  const telegram = { send: async (text, kind) => { sent.push([kind, text]); return { delivered: true }; } };
  let at = T0;
  const { sched } = setup({ telegram, now: () => at });
  await Promise.all(sched.tick());   // the notify lane runs beside the monitors, so it picks their alerts up a minute later
  at += 60000;
  await Promise.all(sched.tick());
  assert.ok(sent.some(([, t]) => /stop on ABBV/.test(t)) && sent.every(([k, t]) => k === "alert" && t.startsWith("Watch-only")), JSON.stringify(sent));
  const first = sent.length;
  at += 60000;
  await Promise.all(sched.tick());
  assert.equal(sent.length, first, "nothing is sent twice");
});

test("market hours are Eastern weekdays 9:30 to 16:00", () => {
  assert.equal(marketOpen(T0), true);
  assert.equal(marketOpen(Date.parse("2026-11-03T14:29:00Z")), false);   // 9:29
  assert.equal(marketOpen(Date.parse("2026-11-03T21:00:00Z")), false);   // 16:00
  assert.equal(marketOpen(Date.parse("2026-11-07T15:00:00Z")), false);   // Saturday
});

test("a lost Robinhood connection is rebuilt on the next call", async () => {
  let opened = 0, fail = true;
  const c = lazyConnection(async () => { opened++; return { call: async () => { if (fail) { fail = false; throw Error("Robinhood MCP 404: session not found"); } return "ok"; } }; });
  await assert.rejects(c.call("get_portfolio"), /404/);
  assert.equal(await c.call("get_portfolio"), "ok");
  assert.equal(await c.call("get_portfolio"), "ok");
  assert.equal(opened, 2);
});

// 2026-11-02 22:05:14Z: the account job and reconcile's balance refresh read Kalshi's balance in the same second and
// the second read got 429 (that endpoint allows 1 call a second, no burst). Concurrent reads now queue and space out.
test("Kalshi balance reads go one at a time, at least 1.1 s apart", async () => {
  const { kalshiReader, BALANCE_GAP_MS } = await import("../src/adapters/readers.mjs");
  const calls = [];
  const ks = { get: async path => { calls.push([path, Date.now()]); return { balance: 806, portfolio_value: 250 }; } };
  const r = kalshiReader(ks);
  const [a, b] = await Promise.all([r.account(), r.account()]);
  assert.deepEqual([a.cash, b.value], [8.06, 10.56]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1][1] - calls[0][1] >= BALANCE_GAP_MS - 5, `second read ${calls[1][1] - calls[0][1]} ms after the first`);
  const failing = kalshiReader({ get: async () => { throw Error("Kalshi 503"); } });
  await assert.rejects(failing.account(), /503/);
  await assert.rejects(failing.account(), /503/);   // a failure never jams the queue
});

// KXNYCSUBWAY on 2026-11-02 after it was decided: status "determined", result "no", no book (no bid 0). The NO held is
// worth $1 at settlement, and no exit may try to sell into the empty book.
test("a decided Kalshi market is valued at its result and never exits", async () => {
  const { kalshiReader } = await import("../src/adapters/readers.mjs");
  const { exitSignal } = await import("../src/monitor.mjs");
  const market = { ticker: "KXNYCSUBWAY-26OCT31-A4500000", status: "determined", result: "no", last_price_dollars: "0.0500", no_bid_dollars: "0.0000", no_ask_dollars: "1.0000" };
  const r = kalshiReader({ get: async () => ({ market }) });
  const p = { broker: "kalshi", instrument: market.ticker, side: "no", plan: '{"stop":0.8,"target":0.98}' };
  const [q] = await r.quotes([p]);
  assert.deepEqual([q.price, q.bid, q.status], [1, 1, "determined"]);
  assert.equal(exitSignal(p, q), null);
  const active = (await kalshiReader({ get: async () => ({ market: { ...market, status: "active", result: "", no_bid_dollars: "0.7500" } }) }).quotes([p]))[0];
  assert.deepEqual(exitSignal(p, active), { why: "stop", price: 0.75 });
});
