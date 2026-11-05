// Richie rebuild: order lifecycle, policy, reconciliation and accounting with simulated adapters (brief, Phase 2
// acceptance). No real order is placed: adapters here are in-memory fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openLedger, positionId } from "../src/ledger.mjs";
import { submitOrder, reconcile, EXECUTION_LEASE } from "../src/execution.mjs";
import { orderProblem } from "../src/policy.mjs";
import { robinhoodAdapter, kalshiAdapter, kalshiView } from "../src/adapters/brokers.mjs";
import { importLegacy } from "../src/migrate.mjs";

const T = 1_800_000_000_000;
const clock = () => { let t = T; const now = () => t; now.add = ms => { t += ms; }; return now; };
function setup(file = ":memory:") {
  const L = openLedger(file), now = clock();
  L.setAccount({ broker: "robinhood", cash: 10, value: 10, source: "test", asOf: now() });
  L.setAccount({ broker: "kalshi", cash: 10, value: 10, source: "test", asOf: now() });
  L.lease(EXECUTION_LEASE, "daemon", 3600000, now());
  return { L, now };
}
const buy = (over = {}) => ({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", quantity: 0.02, limitPrice: 284, plan: { stop: 270, target: 300 }, ...over });
// A broker that remembers what it accepted, so reconcile can find it later.
function fakeBroker({ place } = {}) {
  const orders = new Map(), calls = [];
  return { calls, orders, broker: "robinhood",
    place: async o => { calls.push(o); return place ? place(o, orders) : (orders.set(o.clientId, { state: "submitted", cumQty: 0 }), { state: "submitted", cumQty: 0 }); },
    lookup: async o => orders.get(o.client_id) ?? null,
    positions: async () => [] };
}

test("observation mode never reaches the adapter, and that is the default", async () => {
  const { L, now } = setup(), b = fakeBroker();
  const r = await submitOrder({ ledger: L, adapter: b, order: buy(), owner: "daemon", now });
  assert.equal(r.state, "blocked"); assert.match(r.reason, /Observation mode/);
  assert.equal((await submitOrder({ ledger: L, adapter: b, order: buy(), mode: "LIVE", owner: "daemon", now })).state, "blocked");
  assert.equal(b.calls.length, 0); assert.equal(L.openOrders().length, 0);
});

test("one execution owner: a second process without the lease cannot submit", async () => {
  const { L, now } = setup(), b = fakeBroker();
  assert.equal(L.lease(EXECUTION_LEASE, "cli", 60000, now()), false);
  const r = await submitOrder({ ledger: L, adapter: b, order: buy(), mode: "live", owner: "cli", now });
  assert.match(r.reason, /execution lease/); assert.equal(b.calls.length, 0);
});

test("timeout after broker acceptance: unknown, alerted, no duplicate, then reconciled to a booked fill", async () => {
  const { L, now } = setup();
  const b = fakeBroker({ place: (o, orders) => { orders.set(o.clientId, { state: "filled", cumQty: 0.02, avgPrice: 283.5, fees: 0 }); throw Error("The operation was aborted due to timeout"); } });
  const first = await submitOrder({ ledger: L, adapter: b, order: buy(), mode: "live", owner: "daemon", now });
  assert.equal(first.state, "unknown");
  assert.equal(L.alerts()[0].kind, "order_unknown");
  const again = await submitOrder({ ledger: L, adapter: b, order: buy({ quantity: 0.03 }), mode: "live", owner: "daemon", now });   // changed details, same instrument
  assert.equal(again.state, "blocked"); assert.match(again.reason, /unknown and not reconciled/);
  assert.equal(b.calls.length, 1);
  const report = await reconcile({ ledger: L, adapter: b, now });
  assert.deepEqual(report.resolved, [first.clientId]);
  const p = L.position(positionId("robinhood", "ABBV"));
  assert.equal(p.quantity, 0.02); assert.equal(p.cost_basis, 0.02 * 283.5); assert.equal(p.protection_mode, "richie_watcher");
  assert.equal(L.alerts().filter(a => a.kind === "order_unknown").length, 0);
  await reconcile({ ledger: L, adapter: b, now });   // seeing the same broker record again books nothing twice
  assert.equal(L.position(p.id).quantity, 0.02);
});

test("an explicit broker refusal is final and frees the instrument", async () => {
  const { L, now } = setup();
  const b = fakeBroker({ place: () => { throw Object.assign(Error("Robinhood MCP 422: invalid limit"), { rejected: true }); } });
  assert.equal((await submitOrder({ ledger: L, adapter: b, order: buy(), mode: "live", owner: "daemon", now })).state, "rejected");
  assert.equal(L.pendingFor("robinhood", "ABBV", "buy"), undefined);
});

test("restart keeps the unknown order and still blocks a repeat", async () => {
  const file = join(await mkdtemp(join(tmpdir(), "richie-ledger-")), "ledger.db");
  const { L, now } = setup(file);
  await submitOrder({ ledger: L, adapter: fakeBroker({ place: () => { throw Error("fetch failed"); } }), order: buy(), mode: "live", owner: "daemon", now });
  L.close();
  const again = openLedger(file), b = fakeBroker();
  again.lease(EXECUTION_LEASE, "daemon", 60000, now());
  const r = await submitOrder({ ledger: again, adapter: b, order: buy(), mode: "live", owner: "daemon", now });
  assert.equal(r.state, "blocked"); assert.equal(b.calls.length, 0);
  assert.equal(again.openOrders()[0].state, "unknown");
});

test("a storage failure before submission means no broker call", async () => {
  const { L, now } = setup(), b = fakeBroker();
  L.db.exec("CREATE TRIGGER no_orders BEFORE INSERT ON orders BEGIN SELECT RAISE(ABORT, 'disk full'); END;");
  await assert.rejects(submitOrder({ ledger: L, adapter: b, order: buy(), mode: "live", owner: "daemon", now }), /disk full/);
  assert.equal(b.calls.length, 0);
});

test("pause during research stops a buy before submission but never an exit", async () => {
  const { L, now } = setup(), b = fakeBroker({ place: (o, orders) => (orders.set(o.clientId, { state: "filled", cumQty: o.quantity, avgPrice: 284 }), { state: "filled", cumQty: o.quantity, avgPrice: 284 }) });
  let paused = false;
  const pausing = async () => { const was = paused; paused = true; return was; };   // flips after the policy check
  const r = await submitOrder({ ledger: L, adapter: b, order: buy(), mode: "live", owner: "daemon", now, paused: pausing });
  assert.equal(r.state, "blocked"); assert.match(r.reason, /Paused before submission/); assert.equal(b.calls.length, 0);
  paused = false;
  await submitOrder({ ledger: L, adapter: b, order: buy(), mode: "live", owner: "daemon", now });
  const exit = await submitOrder({ ledger: L, adapter: b, order: buy({ side: "sell", limitPrice: 290 }), mode: "live", owner: "daemon", now, paused: async () => true });
  assert.equal(exit.state, "filled");
});

test("partial fills reported cumulatively are booked once each, with fees and realized P&L", async () => {
  const { L, now } = setup();
  const seq = [{ state: "partially_filled", cumQty: 1, avgPrice: 10, fees: 0.01 }, { state: "partially_filled", cumQty: 1, avgPrice: 10, fees: 0.01 }, { state: "filled", cumQty: 3, avgPrice: 11, fees: 0.03 }];
  const b = fakeBroker({ place: () => seq.shift() });
  b.lookup = async () => seq.shift() ?? null;
  L.setAccount({ broker: "robinhood", cash: 100, value: 100, source: "test", asOf: now() });
  const r = await submitOrder({ ledger: L, adapter: b, order: buy({ instrument: "XLE", instrumentType: "etf", quantity: 3, limitPrice: 12 }), mode: "live", owner: "daemon", now });
  assert.equal(r.state, "partially_filled");
  await reconcile({ ledger: L, adapter: b, now });   // same cumulative quantity: nothing new
  await reconcile({ ledger: L, adapter: b, now });   // final: 2 more at (3 x 11 - 10) / 2 = 11.5
  const p = L.position(positionId("robinhood", "XLE"));
  assert.equal(p.quantity, 3); assert.equal(Number(p.cost_basis.toFixed(6)), 33.03); assert.equal(Number(p.fees.toFixed(6)), 0.03);
  assert.equal(L.order(r.clientId).state, "filled"); assert.equal(L.order(r.clientId).filled_qty, 3);
  // Sell 1 at 12 with a 0.01 fee: realized = 12 - 0.01 - 11.01 = 0.98.
  L.recordIntent({ clientId: "s1", broker: "robinhood", instrument: "XLE", instrumentType: "etf", side: "sell", quantity: 1 }, now());
  L.applyFill({ clientId: "s1", fillKey: "s1:a", qty: 1, price: 12, fee: 0.01, at: now() });
  L.applyFill({ clientId: "s1", fillKey: "s1:a", qty: 1, price: 12, fee: 0.01, at: now() });   // same fill twice
  const after = L.position(p.id);
  assert.equal(after.quantity, 2); assert.equal(Number(after.realized_pnl.toFixed(6)), 0.98); assert.equal(Number(after.cost_basis.toFixed(6)), 22.02);
});

test("reconcile flags stale or missing positions and unmatched inventory without closing anything", async () => {
  const { L, now } = setup();
  L.recordIntent({ clientId: "b1", broker: "robinhood", instrument: "XLE", instrumentType: "etf", side: "buy", quantity: 1, plan: { stop: 60 } }, now());
  L.setOrderState("b1", "filled", {}, now()); L.applyFill({ clientId: "b1", fillKey: "b1:1", qty: 1, price: 63, at: now() });
  const b = fakeBroker(); b.positions = async () => [{ instrument: "DOGE", quantity: 5 }];
  const report = await reconcile({ ledger: L, adapter: b, now });
  assert.deepEqual(report.mismatches.map(m => m.kind).sort(), ["missing_at_broker", "unmatched_inventory"]);
  assert.equal(L.position(positionId("robinhood", "XLE")).status, "open");
  await reconcile({ ledger: L, adapter: b, now });
  assert.equal(L.alerts().length, 2);   // one alert per problem, not one per pass
});

test("incomplete broker pagination is an error, never 'not found'", async () => {
  const { L, now } = setup();
  L.recordIntent({ clientId: "u1", broker: "robinhood", instrument: "SPY", instrumentType: "etf", side: "buy", notional: 1 }, now());
  L.setOrderState("u1", "unknown", {}, now());
  let pages = 0;
  const rh = { call: async name => { if (name === "get_equity_orders") { pages++; return JSON.stringify({ data: { results: [{ ref_id: "other", state: "filled" }], next: "more" } }); } return JSON.stringify({ data: { results: [] } }); } };
  await assert.rejects(reconcile({ ledger: L, adapter: robinhoodAdapter(rh, { account_number: "A" }), now }), /pagination incomplete/);
  assert.equal(pages, 20); assert.equal(L.order("u1").state, "unknown");
  assert.equal(L.health().find(h => h.component === "broker_sync:robinhood").status, "degraded");
  // Found on page 2: resolves.
  let page = 0;
  const rh2 = { call: async name => name === "get_equity_orders" ? JSON.stringify(++page === 1 ? { data: { results: [], next: "p2" } } : { data: { results: [{ ref_id: "u1", state: "cancelled", cumulative_quantity: "0" }] } })
    : JSON.stringify({ data: { results: [] } }) };
  await reconcile({ ledger: L, adapter: robinhoodAdapter(rh2, { account_number: "A" }), now });
  assert.equal(L.order("u1").state, "cancelled");
});

// The real DVN market sell of 2026-11-02 (fixture: Robinhood's own order list, read look-only): Robinhood filled it but
// stored its own ref_id, and the place reply nests the order under data.order. Before the fix it stayed unknown forever.
test("Robinhood: an order stored under Robinhood's own ref_id is matched by symbol, side, size and time, and its fill booked", async () => {
  const real = JSON.parse(await readFile(new URL("../src/fixtures/rh-equity-orders-2026-11-02.json", import.meta.url), "utf8"));
  const sell = real.data.orders.find(r => r.symbol === "DVN" && r.side === "sell");
  const at = Date.parse(sell.created_at);
  const { L } = setup();
  let t = at - 724;   // Richie's intent was written 0.72 s before Robinhood stamped the order
  const now = () => t;
  L.setAccount({ broker: "robinhood", cash: 10, value: 10, source: "test", asOf: t });
  L.lease(EXECUTION_LEASE, "daemon", 3600000, t);
  const filledBuy = fakeBroker({ place: () => ({ state: "filled", cumQty: 0.039494, avgPrice: 50.6399 }) });
  await submitOrder({ ledger: L, adapter: filledBuy, order: { broker: "robinhood", instrument: "DVN", instrumentType: "stock", side: "buy", quantity: 0.039494, limitPrice: 50.63 }, mode: "live", owner: "daemon", now });
  const calls = [];
  const rh = { call: async (name, args) => {
    calls.push([name, args]);
    if (name === "place_equity_order") return JSON.stringify({ data: { order: { ...sell, state: "unconfirmed", cumulative_quantity: "0", average_price: null, executions: [] } } });
    if (name === "get_equity_orders") return JSON.stringify(args.order_id ? { data: { orders: real.data.orders.filter(r => r.id === args.order_id) } } : real);
    return JSON.stringify({ data: { positions: [] } });
  } };
  const adapter = robinhoodAdapter(rh, { account_number: "A" });
  // Place reply lost (as live on 2026-11-02, where it parsed to no state and no id): unknown, then matched by reconcile.
  const lost = { ...adapter, place: async () => robinhoodAdapter({ call: async () => JSON.stringify({ data: { order: { ref_id: "x" } } }) }, {}).place({ instrument: "DVN", quantity: 1 }) };
  const r = await submitOrder({ ledger: L, adapter: lost, order: { broker: "robinhood", instrument: "DVN", instrumentType: "stock", side: "sell", orderType: "market", quantity: 0.039494, limitPrice: 48.8, plan: { why: "close under the 20-day average" } }, mode: "live", owner: "daemon", now });
  assert.equal(r.state, "unknown", r.reason);
  assert.notEqual(sell.ref_id, r.clientId);
  L.alert({ kind: "missing_at_broker", subject: "DVN", text: "gone", at: t, dedupe: "missing_at_broker:robinhood:DVN" });
  t = at + 60000;
  const rep = await reconcile({ ledger: L, adapter, now });
  assert.deepEqual(rep.resolved, [r.clientId]);
  const o = L.order(r.clientId);
  assert.deepEqual([o.state, o.broker_id, o.filled_qty, o.avg_price], ["filled", sell.id, 0.039494, 48.7613]);
  assert.match(o.reason, /Robinhood kept its own ref_id/);
  assert.equal(L.position(positionId("robinhood", "DVN")).status, "closed");
  const trade = L.all("SELECT * FROM trades WHERE instrument = 'DVN'");
  assert.equal(trade.length, 1); assert.equal(trade[0].why, "close under the 20-day average"); assert.equal(trade[0].exit, 48.7613);
  assert.equal(trade[0].closed_at, Date.parse(sell.last_transaction_at));   // the fill's time, not when reconcile found it
  assert.equal(L.alerts().filter(a => a.subject === "DVN").length, 0);
  assert.equal(calls.find(([n]) => n === "get_equity_orders")[1].created_at_gte, new Date(at - 724 - 5000).toISOString());
  // A broker id from the place reply goes straight to single-order lookup; the claimed id is never matched twice.
  const placed = await adapter.place({ instrument: "DVN", instrumentType: "stock", side: "sell", quantity: 0.039494000000000004, clientId: "c2" });
  assert.equal(calls.at(-1)[1].quantity, "0.039494");   // float dust from the ledger is never sent
  assert.deepEqual([placed.state, placed.brokerId], ["submitted", sell.id]);
  assert.equal((await adapter.lookup({ broker_id: sell.id, client_id: "c2" })).state, "filled");
  const twin = { client_id: "c3", instrument: "DVN", side: "sell", requested_qty: 0.039494, created_at: at - 724 };
  assert.equal(await adapter.lookup(twin, { claimed: new Set([sell.id]) }), null);
  assert.equal(await adapter.lookup({ ...twin, created_at: at - 600000 }), null);   // outside the time window
  assert.equal(await adapter.lookup({ ...twin, requested_qty: 0.04 }), null);       // different size
});

test("Kalshi: client order id goes in the body, IOC partial fills read as cancelled with real fills, NO side priced from YES", async () => {
  const posted = [];
  const ks = { post: async (path, body) => { posted.push([path, body]); return { order: { status: "canceled", fill_count: 2, average_fill_price: 0.38, order_id: "k1", taker_fees_dollars: 0.04 } }; }, get: async () => ({}) };
  const v = await kalshiAdapter(ks).place({ instrument: "KX-T", outcomeSide: "no", side: "buy", quantity: 3, limitPrice: 0.62, clientId: "cid-1" });
  assert.equal(posted[0][1].client_order_id, "cid-1"); assert.equal(posted[0][1].reduce_only, false);
  assert.deepEqual([v.state, v.cumQty, Number(v.avgPrice.toFixed(2)), v.fees], ["cancelled", 2, 0.62, 0.04]);
  assert.equal(kalshiView({ status: "resting", fill_count: 0 }, "yes").state, "submitted");
  assert.equal(kalshiView({ status: "mystery" }, "yes").state, "unknown");
});

// Kalshi counts are fixed point to 0.01 (its OpenAPI FixedPointCount). The first live bet was left at 2.64 contracts
// after a partial fill, and a whole-count rule then refused its exit.
test("Kalshi: counts in steps of 0.01 pass policy and go out as two-decimal strings", async () => {
  const { kalshiOrderBody } = await import("../src/core/lib.mjs");
  const account = { broker: "kalshi", cash: 10, value: 10, as_of: T, sample: 0 }, held = { quantity: 2.64 };
  const k = o => ({ broker: "kalshi", instrument: "KXNYCSUBWAY-26OCT31-A4500000", instrumentType: "event_contract", outcomeSide: "no", limitPrice: 0.9, ...o });
  assert.equal(orderProblem(k({ side: "sell", quantity: 2.64 }), { account, held, now: T }), null);
  assert.equal(orderProblem(k({ side: "buy", quantity: 1.31 }), { account, now: T }), null);
  assert.match(orderProblem(k({ side: "sell", quantity: 2.645 }), { account, held: { quantity: 3 }, now: T }), /steps of 0\.01/);
  assert.deepEqual(["2.64", "0.29", "6.00"].map((c, i) => kalshiOrderBody({ ticker: "T", side: "no", count: [2.64, 0.29, 6][i], price: 0.9, sell: true }, "id").count), ["2.64", "0.29", "6.00"]);
});

test("policy: no retired caps, but cash only, fresh balance, approved products and held quantity", () => {
  const now = T, account = { broker: "robinhood", cash: 10, value: 10, as_of: now, sample: 0 };
  assert.equal(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", notional: 10 }, { account, now }), null);   // 100% of the account: allowed
  for (let i = 0; i < 10; i++) assert.equal(orderProblem({ broker: "robinhood", instrument: `S${i}`, instrumentType: "stock", side: "buy", notional: 1 }, { account, now }), null);
  assert.match(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", notional: 10.01 }, { account, now }), /never borrows/);
  assert.match(orderProblem({ broker: "kalshi", instrument: "KX", instrumentType: "event_contract", side: "buy", quantity: 16, limitPrice: 0.62 }, { account: { ...account, broker: "kalshi" }, now }), /with fees/);   // 9.92 + fee
  assert.match(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", notional: 1 }, { account: { ...account, as_of: now - 3600000 }, now }), /stale/);
  assert.match(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", notional: 1 }, { account: { ...account, sample: 1 }, now }), /sample/);
  assert.match(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "option", side: "buy", notional: 1 }, { account, now }), /outside Richie's approved scope/);
  assert.match(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "sell", quantity: 2, limitPrice: 1 }, { account, held: { quantity: 1 }, now }), /more than the 1 held/);
  assert.match(orderProblem({ broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", notional: 1 }, { account, paused: true, now }), /Paused/);
});

test("legacy import keeps raw values, marks estimated basis, and turns pending orders into blocking unknowns", async () => {
  const { L, now } = setup();
  const legacy = { held: { XLE: { entry: 63.05, stop: 61.8, target: 67.2, kind: "etf", dollars: 4.1, quantity: 0.065, at: T - 1e6 }, ETH: { entry: 2333, stop: 2150, target: 2600, kind: "crypto", dollars: 2.1, at: T - 2e6 } },
    pendingOrders: { "ref-9": { symbol: "SPY", side: "buy", status: "uncertain", at: T - 5e5 } }, trades: [{ sym: "XOM", entry: 112, exit: 109, ret: -0.027, dollars: 2, why: "stop", closed: T - 9e6 }],
    paperDone: [{ sym: "NVDA", entry: 131, exit: 136, ret: 0.038, why: "target", closed: T - 8e6 }], kalshi: { held: { "KX-1": { side: "yes", entry: 0.62, dollars: 1.28, at: T - 3e6 } } } };
  const report = importLegacy(L, legacy, { now: now() });
  assert.deepEqual(report.positions.map(p => p.basis), ["confirmed", "estimated", "estimated"]);
  assert.equal(L.position(positionId("robinhood", "ETH")).quantity, 0);
  assert.equal(L.position(positionId("kalshi", "KX-1", "yes")).quantity, 2);
  assert.equal(L.order("ref-9").state, "unknown");
  assert.equal((await submitOrder({ ledger: L, adapter: fakeBroker(), order: buy({ instrument: "SPY", instrumentType: "etf", notional: 1, quantity: undefined, limitPrice: undefined }), mode: "live", owner: "daemon", now })).state, "blocked");
  assert.deepEqual(JSON.parse(L.get("SELECT raw FROM legacy_import").raw), legacy);
  assert.equal(L.trades(false).length, 1); assert.equal(L.trades(true).length, 1);
});

test("reconcile takes the broker's count for an imported position that had none, and only then", async () => {
  const L = openLedger(), now = () => 1000;
  // The real legacy state.json keeps dollars and entry for held stocks, never a share count (dry run, 2026-11-02).
  importLegacy(L, { held: { XLE: { kind: "etf", dollars: 4, entry: 67.2, stop: 63.8, target: 74, at: 1 }, ABBV: { kind: "stock", quantity: 0.0141, dollars: 4, entry: 283.67, stop: 266 } } }, { now: 1 });
  const adapter = { broker: "robinhood", lookup: async () => null, positions: async () => [{ instrument: "XLE", quantity: 0.0595, avgPrice: 67.2 }, { instrument: "ABBV", quantity: 0.02 }] };
  const r = await reconcile({ ledger: L, adapter, now });
  assert.deepEqual(r.adopted, ["XLE"]);
  assert.equal(L.position(positionId("robinhood", "XLE")).quantity, 0.0595);
  assert.equal(L.position(positionId("robinhood", "XLE")).basis_status, "confirmed");   // from the broker's average price
  assert.ok(Math.abs(L.position(positionId("robinhood", "XLE")).cost_basis - 0.0595 * 67.2) < 1e-9);
  // A position that had a recorded quantity is never overwritten: a disagreement stays an alert.
  assert.equal(L.position(positionId("robinhood", "ABBV")).quantity, 0.0141);
  assert.deepEqual(r.mismatches.map(m => m.kind), ["quantity_mismatch"]);
  assert.equal((await reconcile({ ledger: L, adapter, now })).adopted, undefined, "adopted once");
});

test("a settled Kalshi bet is booked at its payout from the real settlement record, never reported missing", async () => {
  const L = openLedger(), now = () => 5000;
  importLegacy(L, { kalshi: { held: { "KXRAIN-26NOV03": { side: "no", dollars: 1.2, entry: 0.4 } } } }, { now: 1 });
  // Field names and units as Kalshi returned them on 2026-11-02 (revenue in cents, costs in dollars).
  const st = { event_ticker: "KXRAIN", fee_cost: "0.030000", market_result: "no", no_count_fp: "3.00", no_total_cost_dollars: "1.200000", revenue: 300,
    settled_time: "2026-11-04T03:35:49.285491Z", ticker: "KXRAIN-26NOV03", value: 100, yes_count_fp: "0.00", yes_total_cost_dollars: "0.000000" };
  const adapter = { broker: "kalshi", lookup: async () => null, positions: async () => [], settlements: async () => [st] };
  const r = await reconcile({ ledger: L, adapter, now });
  assert.deepEqual(r.settled, ["KXRAIN-26NOV03"]); assert.deepEqual(r.mismatches, []);
  assert.equal(L.positions("open").length, 0);
  const t = L.trades(false)[0];
  assert.equal(t.why, "settled no"); assert.ok(Math.abs(t.ret - 1.5) < 1e-9);   // paid $3.00 on $1.20
  assert.match(L.alerts().find(a => a.kind === "settled").text, /^Settled: KXRAIN-26NOV03 resolved NO, so the NO side won\. Paid \$3\.00, a gain of \$1\.80\.$/);
  // A position that is gone with no settlement is still reported, as before.
  importLegacy(L, { kalshi: { held: { KXOTHER: { side: "yes", dollars: 1, entry: 0.5 } } } }, { now: 2 });
  assert.deepEqual((await reconcile({ ledger: L, adapter, now })).mismatches.map(m => m.kind), ["missing_at_broker"]);
});

test("a position sold out completely becomes a closed trade with its exit reason", async () => {
  const L = openLedger(), now = () => 1000;
  importLegacy(L, { held: { XLE: { kind: "etf", quantity: 2, dollars: 134, entry: 67, stop: 63.8, target: 74 } } }, { now: 1 });
  L.recordIntent({ clientId: "s1", broker: "robinhood", instrument: "XLE", instrumentType: "etf", side: "sell", quantity: 2, plan: { why: "target" } }, 500);
  L.applyFill({ clientId: "s1", fillKey: "f1", qty: 2, price: 74, fee: 0, at: 900 });
  const t = L.trades(false)[0];
  assert.equal(t.why, "target"); assert.equal(t.exit, 74); assert.ok(Math.abs(t.ret - (74 / 67 - 1)) < 1e-9);
});

// The first live Kalshi bet (2026-11-02): 6 NO bought at 93c (fee 2.74c), 3.36 sold at 91c (fee 1.93c), 2.64 left to
// settle NO at $1. The trade row must cover all 6, not only the 2.64 that settled.
test("a holding partly sold and then settled is one trade over all of it", () => {
  const { L } = setup(), id = positionId("kalshi", "KXNYCSUBWAY-26OCT31-A4500000", "no");
  const k = (clientId, side, quantity, limitPrice) => L.recordIntent({ clientId, broker: "kalshi", instrument: "KXNYCSUBWAY-26OCT31-A4500000", instrumentType: "event_contract", side, outcomeSide: "no", quantity, limitPrice, plan: side === "sell" ? { why: "target" } : { stop: null, target: null } }, T);
  k("b", "buy", 6, 0.93); L.applyFill({ clientId: "b", fillKey: "b", qty: 6, price: 0.93, fee: 0.0274, at: T });
  k("s", "sell", 6, 0.91); L.applyFill({ clientId: "s", fillKey: "s", qty: 3.36, price: 0.91, fee: 0.0193, at: T + 1000 });
  assert.equal(L.trades(false).length, 0, "a partial sale is not yet a closed trade");
  const out = L.settlePosition(id, { payout: 2.64, result: "no", at: T + 3600000 });
  const [t] = L.trades(false), avg = (6 * 0.93 + 0.0274) / 6;
  assert.equal(Number(t.dollars.toFixed(4)), Number((avg * 6).toFixed(4)));                  // all 6 contracts' cost
  assert.equal(Number(t.exit.toFixed(4)), Number(((2.64 + 3.36 * 0.91) / 6).toFixed(4)));
  assert.equal(Number(t.ret.toFixed(4)), Number(((2.64 + 3.36 * 0.91 - 0.0193) / (avg * 6) - 1).toFixed(4)));
  assert.equal(t.why, "settled no");
  assert.equal(Number((L.position(id).realized_pnl).toFixed(4)), Number((2.64 + 3.36 * 0.91 - 0.0193 - avg * 6).toFixed(4)));   // same money as the row
  assert.ok(out.pnl > 0);
});

// DVN was sold on 2026-11-02 after being held since Oct 16. Buying it again must start a new holding: an old open time
// would trip the 20-trading-day exit at once, and the old plan and P&L would carry over.
test("a symbol bought again after a full exit is a new holding", () => {
  const { L } = setup(), id = positionId("robinhood", "DVN");
  const rh = (clientId, side, quantity, limitPrice, plan, at) => { L.recordIntent({ clientId, broker: "robinhood", instrument: "DVN", instrumentType: "stock", side, quantity, limitPrice, plan }, at); L.applyFill({ clientId, fillKey: clientId, qty: quantity, price: limitPrice, at }); };
  rh("b1", "buy", 0.039494, 50.64, { stop: 47, target: 58 }, T - 20 * 86400000);
  rh("s1", "sell", 0.039494, 48.76, { why: "close under the 20-day average" }, T - 86400000);
  assert.equal(L.position(id).status, "closed");
  rh("b2", "buy", 0.04, 49, { stop: 45.5, target: 56 }, T);
  const p = L.position(id);
  assert.deepEqual([p.status, p.opened_at, p.quantity, Number(p.cost_basis.toFixed(2)), p.realized_pnl, JSON.parse(p.plan).stop, p.protection_mode], ["open", T, 0.04, 1.96, 0, 45.5, "richie_watcher"]);
  rh("s2", "sell", 0.04, 50, { why: "target" }, T + 86400000);
  const second = L.trades(false).find(t => t.why === "target");
  assert.equal(Number(second.dollars.toFixed(2)), 1.96);   // only the new holding's sale, not DVN's first one
  assert.equal(second.opened_at, T);
});

// The balance is read every 2 minutes. A second buy before the next reading saw the cash the first had already used,
// and the Robinhood account is limited margin, where that could borrow.
test("a buy since the last balance reading counts against the cash, so two buys cannot spend it twice", async () => {
  const { L, now } = setup();
  const b = fakeBroker({ place: (o, orders) => { const v = { state: "filled", cumQty: o.quantity, avgPrice: o.limitPrice, fees: 0 }; orders.set(o.clientId, v); return v; } });
  now.add(1000);
  const first = await submitOrder({ ledger: L, adapter: b, order: buy({ quantity: 0.03, limitPrice: 200 }), mode: "live", owner: "daemon", now });   // $6 of the $10
  assert.equal(first.state, "filled");
  const second = await submitOrder({ ledger: L, adapter: b, order: buy({ instrument: "XLE", instrumentType: "etf", quantity: 0.1, limitPrice: 50 }), mode: "live", owner: "daemon", now });   // $5
  assert.equal(second.state, "blocked"); assert.match(second.reason, /only \$4\.00 cash/);
  assert.equal(b.calls.length, 1);
  // A refused buy spent nothing, and a fresh reading (which includes the first buy) starts the count again.
  const refused = fakeBroker({ place: () => { throw Object.assign(Error("Robinhood MCP 400: no"), { rejected: true }); } });
  now.add(1000);
  L.setAccount({ broker: "robinhood", cash: 4, value: 10, source: "test", asOf: now() });
  now.add(1000);
  assert.equal((await submitOrder({ ledger: L, adapter: refused, order: buy({ instrument: "XOM", quantity: 0.01, limitPrice: 200 }), mode: "live", owner: "daemon", now })).state, "rejected");
  assert.equal((await submitOrder({ ledger: L, adapter: b, order: buy({ instrument: "XLE", instrumentType: "etf", quantity: 0.07, limitPrice: 50 }), mode: "live", owner: "daemon", now })).state, "filled");
});

test("two lanes selling the same holding at once send one order", async () => {
  const { L, now } = setup();
  importLegacy(L, { held: { ABBV: { kind: "stock", quantity: 0.02, dollars: 5.6, entry: 280, stop: 266 } } }, { now: now() });
  const b = fakeBroker({ place: async (o, orders) => { await new Promise(r => setTimeout(r, 5)); orders.set(o.clientId, { state: "submitted", cumQty: 0 }); return { state: "submitted", cumQty: 0 }; } });
  const sell = () => submitOrder({ ledger: L, adapter: b, order: buy({ side: "sell", orderType: "market" }), mode: "live", owner: "daemon", now, paused: async () => false });
  const [a, c] = await Promise.all([sell(), sell()]);
  assert.equal(b.calls.length, 1);
  assert.deepEqual([a.state, c.state].sort(), ["blocked", "submitted"]);
});

test("Kalshi: a fill is counted from the fixed-point count, never a whole-number field", () => {
  const v = kalshiView({ status: "canceled", fill_count: 2, fill_count_fp: "2.64", yes_price_dollars: "0.9100", order_id: "k2" }, "yes");
  assert.equal(v.cumQty, 2.64); assert.equal(v.state, "cancelled");
});

test("Robinhood: a sale never asks for more than is held; dollar amounts go in whole cents, and lookup matches what was sent", async () => {
  const placed = [];
  const rh = { call: async (name, a) => { if (name.startsWith("place_")) { placed.push(a); return JSON.stringify({ data: { order: { id: "o", state: "queued" } } }); }
    return JSON.stringify({ data: { results: [{ id: "o2", side: "sell", symbol: "DVN", quantity: "0.039483", created_at: new Date(T + 1000).toISOString(), state: "filled", agent_initiated: true }] } }); } };
  const adapter = robinhoodAdapter(rh, { account_number: "A" });
  await adapter.place({ instrument: "DVN", side: "sell", quantity: 0.0394839, clientId: "a" });          // 7 decimals held: round down
  await adapter.place({ instrument: "DVN", side: "sell", quantity: 0.039483000000000004, clientId: "b" }); // float dust: no unit lost
  await adapter.place({ instrument: "DVN", side: "sell", quantity: 0.0394829999999, clientId: "c" });
  await adapter.place({ instrument: "BTC", instrument_type: "crypto", side: "sell", quantity: 0.000123456789, limitPrice: 70000, clientId: "d" });
  await adapter.place({ instrument: "DVN", side: "buy", notional: 3.3333, clientId: "e" });
  assert.deepEqual(placed.map(a => a.quantity ?? a.dollar_amount), ["0.039483", "0.039483", "0.039483", "0.00012345", "3.33"]);
  const found = await adapter.lookup({ instrument: "DVN", side: "sell", requested_qty: 0.0394839, created_at: T, client_id: "a" });
  assert.match(found?.reason ?? "", /matched by symbol, side, size and time/, "the 7-decimal request matches the rounded order Robinhood holds");
});
