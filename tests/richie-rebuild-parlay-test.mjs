// Richie rebuild: Kalshi parlays. Offline only: a fake Kalshi connection.
// The leg markets are real, captured from Kalshi's public API (tests/fixtures/kalshi-nfl-legs.json); so are a request,
// its makers' quotes and a fill (tests/fixtures/kalshi-combo-quotes.json, Richie's account, read-only). The accept
// itself follows Kalshi's OpenAPI 3.35.0 and FIX RFQ docs. src/parlay-check.mjs runs the rest live with no money.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openLedger } from "../src/ledger.mjs";
import { handleProposal, parlayProblem } from "../src/sessions.mjs";
import { parlayQuote, comboLiveQuote } from "../src/live-sessions.mjs";
import { kalshiAdapter } from "../src/adapters/brokers.mjs";
import { comboYesCost, bestComboQuote, isCombo, COMBO_COLLECTION } from "../src/core/lib.mjs";

const { markets: [SPREAD, TOTAL] } = JSON.parse(readFileSync(new URL("./fixtures/kalshi-nfl-legs.json", import.meta.url), "utf8"));
const REAL = JSON.parse(readFileSync(new URL("./fixtures/kalshi-combo-quotes.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-03T17:00:00Z"), now = () => NOW;
const COMBO = "KXMVECROSSCATEGORY-S2026TEST-ABC123";
const quote = (o = {}) => ({ id: "q1", rfq_id: "r1", market_ticker: COMBO, contracts_fp: "2.00", yes_bid_dollars: "0.7600", no_bid_dollars: "0.8000", status: "open", ...o });
const SRC = ["https://kalshi.com/markets/kxnflspread", "https://example.com/odds", "https://example.com/injuries"];

// A fake Kalshi: routes by method and path, records every call.
function fakeKalshi(routes) {
  const calls = [];
  const hit = method => async (path, body) => {
    calls.push([method, path, body]);
    const key = Object.keys(routes).find(k => { const [m, p] = k.split(" "); return m === method && path.startsWith(p); });
    if (!key) throw Error(`Kalshi 404: no route ${method} ${path}`);
    // Live Kalshi answers a quote list without rfq_user_filter=self with 403 (2026-11-03).
    if (method === "GET" && path.startsWith("/communications/quotes") && !path.includes("rfq_user_filter=self")) throw Error("Kalshi 403: Either creator_user_id or rfq_creator_user_id must be filled.");
    const r = routes[key];
    return typeof r === "function" ? r(path, body) : r;
  };
  return { calls, get: hit("GET"), post: hit("POST"), put: hit("PUT"), delete: hit("DELETE") };
}

test("combo helpers: buying YES costs 1 minus the maker's NO bid, and the cheapest open quote wins", () => {
  assert.equal(comboYesCost(quote()), 0.2);
  assert.equal(comboYesCost(quote({ no_bid_dollars: "0" })), null, "a maker declining NO offers no YES to buy");
  assert.equal(bestComboQuote([quote({ id: "a", no_bid_dollars: "0.70" }), quote({ id: "b", no_bid_dollars: "0.82" }), quote({ id: "c", no_bid_dollars: "0.90", status: "cancelled" })]).id, "b");
  assert.ok(isCombo(COMBO)); assert.ok(!isCombo(SPREAD.ticker)); assert.ok(isCombo("KXMVECROSSCATEGORY0-S2026E4A4O2XUTKINWIYQ-RJ2ZGTC5K"));
});

test("real makers' quotes: the best YES is 1 minus the highest NO bid, matching what Kalshi offers for a target cost", () => {
  const best = bestComboQuote(REAL.quotes);
  assert.equal(best.id, "d6cb21ab-d896-4afb-ad5e-0b30b5ba1e75");
  assert.equal(comboYesCost(best), 0.588);
  // $10 buys 16.52 contracts on this quote's NO side: about 0.605 each, the 0.588 YES price plus its fee. So accepting the
  // maker's NO quote is what buys YES.
  assert.ok(Math.abs(10 / Number(best.no_contracts_fp) - 0.588) < 0.02);
  for (const q of REAL.quotes) assert.ok(Number(q.yes_bid_dollars) + Number(q.no_bid_dollars) <= 1, "both prices are bids");
});

test("a parlay quote builds the combo from real legs, asks for the exact size and reports the product of the legs", async () => {
  const ks = fakeKalshi({
    [`GET /markets/${SPREAD.ticker}`]: { market: SPREAD }, [`GET /markets/${TOTAL.ticker}`]: { market: TOTAL },
    "DELETE /communications/rfqs/": {},
    [`POST /multivariate_event_collections/${COMBO_COLLECTION}`]: { event_ticker: "KXMVECROSSCATEGORY-S2026TEST", market_ticker: COMBO },
    "POST /communications/rfqs": { id: "r1" },
    "GET /communications/quotes": (() => { let n = 0; return () => ({ quotes: n++ ? [quote()] : [] }); })(),
  });
  // Richie's own earlier requests: one stale on another combo, one on this combo, one fresh elsewhere. The owner's app
  // requests are not in here, so they are never touched.
  const own = new Map([["KXMVE-OLD", { id: "old", at: NOW - 31 * 60000 }], [COMBO, { id: "same", at: NOW - 60000 }], ["KXMVE-FRESH", { id: "fresh", at: NOW - 60000 }]]);
  const out = await parlayQuote(ks, { legs: [{ ticker: SPREAD.ticker, side: "yes" }, { ticker: TOTAL.ticker, side: "no" }], contracts: 2 }, { sleep: async () => {}, now, own });
  const created = ks.calls.find(c => c[1].startsWith("/multivariate_event_collections"));
  assert.deepEqual(created[2].selected_markets, [{ market_ticker: SPREAD.ticker, event_ticker: SPREAD.event_ticker, side: "yes" }, { market_ticker: TOTAL.ticker, event_ticker: TOTAL.event_ticker, side: "no" }]);
  assert.deepEqual(ks.calls.find(c => c[1] === "/communications/rfqs")[2], { market_ticker: COMBO, contracts_fp: "2.00", rest_remainder: false });
  assert.deepEqual(ks.calls.filter(c => c[0] === "DELETE").map(c => c[1]), ["/communications/rfqs/old", "/communications/rfqs/same"]);
  assert.ok(!ks.calls.some(c => c[0] === "GET" && c[1].startsWith("/communications/rfqs")), "never lists the account's requests (the owner's are there too)");
  assert.deepEqual([...own.keys()].sort(), [COMBO, "KXMVE-FRESH"].sort());
  assert.deepEqual(own.get(COMBO), { id: "r1", at: NOW, contracts: 2 });
  assert.match(out, /Product of the leg asks: 0\.6160 /);   // 0.80 x 0.77, the real asks
  assert.match(out, /Best quote: buy YES at 0\.2 for 2 contracts/);
  assert.match(out, new RegExp(`propose_trade instrument ${COMBO}, outcomeSide yes, limitPrice 0\\.2, quantity 2`));
});

test("no maker answer is a pass, and a closed leg stops the quote before anything is created", async () => {
  const base = { [`GET /markets/${SPREAD.ticker}`]: { market: SPREAD }, [`GET /markets/${TOTAL.ticker}`]: { market: TOTAL },
    [`POST /multivariate_event_collections/${COMBO_COLLECTION}`]: { market_ticker: COMBO }, "POST /communications/rfqs": { id: "r1" }, "GET /communications/quotes": { quotes: [] } };
  const legs = [{ ticker: SPREAD.ticker, side: "yes" }, { ticker: TOTAL.ticker, side: "yes" }];
  assert.match(await parlayQuote(fakeKalshi(base), { legs, contracts: 1 }, { sleep: async () => {}, now, own: new Map() }), /No maker quoted in 30 seconds\. Pass/);
  const closed = fakeKalshi({ ...base, [`GET /markets/${TOTAL.ticker}`]: { market: { ...TOTAL, status: "closed" } } });
  assert.match(await parlayQuote(closed, { legs, contracts: 1 }, { sleep: async () => {}, now, own: new Map() }), /leg KXNFLTOTAL-26NOV05JACBAL-50 is closed/);
  assert.ok(!closed.calls.some(c => c[0] === "POST"));
  assert.match(await parlayQuote(fakeKalshi(base), { legs: legs.slice(0, 1), contracts: 1 }), /at least 2 legs/);
});

test("the parlay gate: YES only, no stop or target, an open quote, its exact size", () => {
  const live = { price: 0.2, ask: 0.2, rfqId: "r1", quoteId: "q1", contracts: 2 };
  const p = { instrument: COMBO, outcomeSide: "yes", quantity: 2, stop: null, target: null };
  assert.equal(parlayProblem(p, live), null);
  assert.match(parlayProblem({ ...p, outcomeSide: "no" }, live), /YES side only/);
  assert.match(parlayProblem({ ...p, stop: 0.1 }, live), /held to settlement/);
  assert.match(parlayProblem(p, null), /no open quote/);
  assert.match(parlayProblem({ ...p, quantity: 1 }, live), /quote is for 2 contracts/);
});

test("a passed parlay buy carries the quote to the adapter; a parlay above the live quote is refused unseen", async () => {
  const L = openLedger();
  L.setAccount({ broker: "kalshi", cash: 100, value: 100, source: "test", asOf: NOW });
  const live = { price: 0.2, ask: 0.2, bid: null, rfqId: "r1", quoteId: "q1", contracts: 2 };
  const parlay = { instrument: COMBO, side: "buy", outcomeSide: "yes", quantity: 2, limitPrice: 0.2, fair: 0.34, thesis: "Leg 1 JAC -2.5 at 0.80, mine 0.80; leg 2 under 49.5 at 0.77, mine 0.78; joint 0.34 after negative correlation",
    invalidation: "Lawrence ruled out", resolves: "Both legs settle Nov 8", sources: SRC };
  let reviewed = 0;
  const high = await handleProposal({ ...parlay, limitPrice: 0.25 }, { ledger: L, broker: "kalshi", review: async () => { reviewed++; return "PASS"; }, liveQuote: async () => live, now });
  assert.match(high, /^Not sent: your price 0\.25 is not the live ask 0\.2/);
  assert.equal(reviewed, 0);
  const placed = [];
  const adapter = { place: async o => { placed.push(o); return { state: "filled", cumQty: 2, avgPrice: 0.2, fees: 0.03 }; } };
  L.lease("execution", "parlay-test", 60000, NOW);
  const out = await handleProposal(parlay, { ledger: L, broker: "kalshi", review: async () => "PASS: legs priced from the market", liveQuote: async () => live, mode: "live", owner: "parlay-test", adapter, now });
  assert.match(out, /^Order filled/);
  assert.deepEqual(placed[0].rfq, { rfqId: "r1", quoteId: "q1" });
  assert.deepEqual(JSON.parse(L.all("SELECT plan FROM orders")[0].plan), { stop: null, target: null, entry: 0.2, source: "session case" });

  // A lapsed quote comes back with its reason, so Richie knows to quote again.
  const L2 = openLedger();
  L2.setAccount({ broker: "kalshi", cash: 100, value: 100, source: "test", asOf: NOW });
  L2.lease("execution", "parlay-test", 60000, NOW);
  const lapsing = { place: async () => { throw Object.assign(Error("Kalshi 400: the quote is cancelled"), { rejected: true }); } };
  const lapsed = await handleProposal(parlay, { ledger: L2, broker: "kalshi", review: async () => "PASS: ok", liveQuote: async () => live, mode: "live", owner: "parlay-test", adapter: lapsing, now });
  assert.match(lapsed, /^Order rejected \(client id .+\): .*the quote is cancelled\.$/);
});

test("the adapter accepts the maker's NO side to buy YES, books the fills, and refuses a moved or lapsed quote", async () => {
  const path = "/communications/rfqs/r1/quotes/q1";
  let status = "open";
  const ks = fakeKalshi({
    [`GET ${path}`]: () => ({ quote: quote({ status, rfq_creator_order_id: status === "executed" ? "ord-mine" : undefined }) }),
    [`PUT ${path}/accept`]: () => { status = "executed"; return {}; },
    // An earlier buy of the same combo filled a second before: its fill has another order id and is not this order's.
    "GET /portfolio/fills": { fills: [{ ticker: COMBO, order_id: "ord-mine", outcome_side: "yes", count_fp: "2.00", yes_price_dollars: "0.2000", fee_cost: "0.0300", created_time: "2026-11-03T17:00:02Z" },
      { ticker: COMBO, order_id: "ord-earlier", outcome_side: "yes", count_fp: "5.00", yes_price_dollars: "0.1900", fee_cost: "0.0700", created_time: "2026-11-03T16:59:59Z" }], cursor: "" },
  });
  const order = { instrument: COMBO, side: "buy", outcomeSide: "yes", quantity: 2, limitPrice: 0.2, clientId: "c1", rfq: { rfqId: "r1", quoteId: "q1" } };
  const v = await kalshiAdapter(ks, { sleep: async () => {}, now }).place(order);
  assert.deepEqual(ks.calls.find(c => c[0] === "PUT")[2], { accepted_side: "no" });
  assert.deepEqual([v.state, v.cumQty, v.avgPrice, v.fees, v.brokerId], ["filled", 2, 0.2, 0.03, "r1/q1"]);
  assert.ok(!ks.calls.some(c => c[1] === "/portfolio/events/orders"), "no book order for a parlay");

  const moved = fakeKalshi({ [`GET ${path}`]: { quote: quote({ no_bid_dollars: "0.75" }) } });
  await assert.rejects(kalshiAdapter(moved, { sleep: async () => {}, now }).place(order), e => e.rejected && /moved to 0\.25/.test(e.message));
  const gone = fakeKalshi({ [`GET ${path}`]: { quote: quote({ status: "cancelled" }) } });
  await assert.rejects(kalshiAdapter(gone, { sleep: async () => {}, now }).place(order), e => e.rejected && /quote is cancelled/.test(e.message));
  await assert.rejects(kalshiAdapter(gone).place({ ...order, rfq: undefined }), e => e.rejected && /no quote to accept/.test(e.message));
});

test("a maker who never confirms is a cancel with no fills; reconcile finds late fills or gives up after 5 minutes", async () => {
  const path = "/communications/rfqs/r1/quotes/q1";
  let status = "open";
  const ks = fakeKalshi({ [`GET ${path}`]: () => ({ quote: quote({ status, cancellation_reason: status === "cancelled" ? "not confirmed" : undefined }) }),
    [`PUT ${path}/accept`]: () => { status = "cancelled"; return {}; } });
  const order = { instrument: COMBO, side: "buy", outcomeSide: "yes", quantity: 2, limitPrice: 0.2, clientId: "c1", rfq: { rfqId: "r1", quoteId: "q1" } };
  const v = await kalshiAdapter(ks, { sleep: async () => {}, now }).place(order);
  assert.deepEqual([v.state, v.cumQty], ["cancelled", 0]);

  const none = fakeKalshi({ "GET /portfolio/fills": { fills: [] } });
  const row = { instrument: COMBO, side: "buy", client_id: "c1", created_at: NOW - 60000 };
  assert.equal(await kalshiAdapter(none, { now }).lookup(row), null, "too soon to call it");
  assert.equal((await kalshiAdapter(none, { now }).lookup({ ...row, created_at: NOW - 6 * 60000 })).state, "cancelled");
  const late = fakeKalshi({ "GET /portfolio/fills": { fills: [{ outcome_side: "yes", count_fp: "1.50", yes_price_dollars: "0.2100", fee_cost: "0.02", created_time: "2026-11-03T16:59:30Z" }] } });
  const found = await kalshiAdapter(late, { now }).lookup(row);
  assert.deepEqual([found.state, found.cumQty, found.avgPrice], ["filled", 1.5, 0.21]);
  // With the quote's path saved, reconcile reads the quote: a lapse is a cancel at once, an execution is matched by order id.
  const saved = { ...row, broker_id: "r1/q1" };
  const lapsed = fakeKalshi({ "GET /communications/rfqs/r1/quotes/q1": { quote: quote({ status: "cancelled", cancellation_reason: "not confirmed" }) } });
  assert.deepEqual([(await kalshiAdapter(lapsed, { now }).lookup(saved)).state], ["cancelled"]);
  const done = fakeKalshi({ "GET /communications/rfqs/r1/quotes/q1": { quote: quote({ status: "executed", rfq_creator_order_id: "ord-mine" }) },
    "GET /portfolio/fills": { fills: [{ order_id: "ord-other", outcome_side: "yes", count_fp: "4.00", yes_price_dollars: "0.30", created_time: "2026-11-03T16:59:40Z" },
      { order_id: "ord-mine", outcome_side: "yes", count_fp: "2.00", yes_price_dollars: "0.20", fee_cost: "0.03", created_time: "2026-11-03T16:59:41Z" }] } });
  assert.deepEqual(Object.values((({ state, cumQty }) => ({ state, cumQty }))(await kalshiAdapter(done, { now }).lookup(saved))), ["filled", 2]);
});

test("the combo live price is the best open quote on Richie's own request, never on one the owner made in the app", async () => {
  const own = new Map([[COMBO, { id: "r1", at: NOW, contracts: 2 }]]);
  const ks = fakeKalshi({ "GET /communications/rfqs/r1": { rfq: { id: "r1", status: "open", contracts_fp: "2.00" } },
    "GET /communications/quotes": path => ({ quotes: path.includes("rfq_id=r1") ? [quote({ id: "q9", no_bid_dollars: "0.79" }), quote()] : [] }) });
  assert.deepEqual(await comboLiveQuote(ks, COMBO, own), { price: 0.2, ask: 0.2, bid: null, rfqId: "r1", quoteId: "q1", contracts: 2 });
  // The owner's own open request on a combo (real, from the app) is invisible to Richie: no own entry, no price.
  assert.equal(await comboLiveQuote(fakeKalshi({}), REAL.rfq.market_ticker, own), null);
  const closed = fakeKalshi({ "GET /communications/rfqs/r1": { rfq: { id: "r1", status: "closed", contracts_fp: "2.00" } } });
  assert.equal(await comboLiveQuote(closed, COMBO, own), null);
});

test("a NO fill on a parlay buy is never booked: it throws so the order stays unknown and an alert goes out", async () => {
  const path = "/communications/rfqs/r1/quotes/q1";
  let status = "open";
  const ks = fakeKalshi({ [`GET ${path}`]: () => ({ quote: quote({ status, rfq_creator_order_id: "ord-mine" }) }), [`PUT ${path}/accept`]: () => { status = "executed"; return {}; },
    "GET /portfolio/fills": { fills: [{ ...REAL.fill, ticker: COMBO, order_id: "ord-mine", outcome_side: "no", side: "no", count_fp: "2.00", created_time: "2026-11-03T17:00:02Z" }] } });
  const order = { instrument: COMBO, side: "buy", outcomeSide: "yes", quantity: 2, limitPrice: 0.2, clientId: "c1", rfq: { rfqId: "r1", quoteId: "q1" } };
  await assert.rejects(kalshiAdapter(ks, { sleep: async () => {}, now }).place(order), e => !e.rejected && /filled on the NO side \(2 contracts/.test(e.message));
  // A quote that cannot be read before the accept is a clean refusal: nothing was sent.
  const down = fakeKalshi({});
  await assert.rejects(kalshiAdapter(down, { sleep: async () => {}, now }).place(order), e => e.rejected && /could not read the quote/.test(e.message));
  assert.ok(!down.calls.some(c => c[0] === "PUT"));
});

test("a real fill parses: count, price and fee", async () => {
  const ks = fakeKalshi({ "GET /portfolio/fills": { fills: [{ ...REAL.fill, ticker: COMBO, created_time: "2026-11-03T17:00:01Z" }] } });
  const v = await kalshiAdapter(ks, { now }).lookup({ instrument: COMBO, side: "buy", client_id: "c1", created_at: NOW });
  assert.deepEqual([v.state, v.cumQty, v.avgPrice, v.fees], ["filled", 0.73, 0.09, 0.0042]);
});

test("the monitor's Kalshi reader skips a combo Kalshi will not serve yet and still reads the other positions", async () => {
  const { kalshiReader } = await import("../src/adapters/readers.mjs");
  const ks = fakeKalshi({ [`GET /markets/${SPREAD.ticker}`]: { market: { ...SPREAD, last_price_dollars: "0.79" } } });
  const rows = await kalshiReader(ks, { now }).quotes([{ broker: "kalshi", instrument: COMBO, side: "yes" }, { broker: "kalshi", instrument: SPREAD.ticker, side: "yes" }]);
  assert.deepEqual(rows.map(r => [r.instrument, r.bid]), [[SPREAD.ticker, 0.79]]);
  const down = { get: async () => { throw Error("Kalshi 503: down"); } };
  await assert.rejects(kalshiReader(down, { now }).quotes([{ broker: "kalshi", instrument: SPREAD.ticker, side: "yes" }]), /503/, "an outage still fails the pass loudly");
});

test("a NO fill found by reconcile marks only that order unknown; it never stops reconcile for the other Kalshi bets", async () => {
  const ks = fakeKalshi({ "GET /communications/rfqs/r1/quotes/q1": { quote: quote({ status: "executed", rfq_creator_order_id: "ord-mine" }) },
    "GET /portfolio/fills": { fills: [{ ...REAL.fill, ticker: COMBO, order_id: "ord-mine", outcome_side: "no", side: "no", count_fp: "1.00", created_time: "2026-11-03T16:59:41Z" }] } });
  const v = await kalshiAdapter(ks, { now }).lookup({ instrument: COMBO, side: "buy", client_id: "c1", created_at: NOW - 60000, broker_id: "r1/q1", requested_qty: 1 });
  assert.equal(v.state, "unknown");
  assert.match(v.reason, /filled on the NO side \(1 contracts/);
});

test("fills that show up in pieces are booked as partial until the full size is there", async () => {
  const path = "/communications/rfqs/r1/quotes/q1";
  let status = "open";
  const half = [{ ...REAL.fill, ticker: COMBO, order_id: "ord-mine", count_fp: "1.00", yes_price_dollars: "0.2000", created_time: "2026-11-03T17:00:02Z" }];
  const ks = fakeKalshi({ [`GET ${path}`]: () => ({ quote: quote({ status, rfq_creator_order_id: "ord-mine" }) }), [`PUT ${path}/accept`]: () => { status = "executed"; return {}; },
    "GET /portfolio/fills": { fills: half } });
  const order = { instrument: COMBO, side: "buy", outcomeSide: "yes", quantity: 2, limitPrice: 0.2, clientId: "c1", rfq: { rfqId: "r1", quoteId: "q1" } };
  const v = await kalshiAdapter(ks, { sleep: async () => {}, now }).place(order);
  assert.deepEqual([v.state, v.cumQty], ["partially_filled", 1]);
  const row = { instrument: COMBO, side: "buy", client_id: "c1", broker_id: "r1/q1", requested_qty: 2 };
  assert.equal((await kalshiAdapter(ks, { now }).lookup({ ...row, created_at: NOW - 60000 })).state, "partially_filled");
  const late = await kalshiAdapter(ks, { now }).lookup({ ...row, created_at: NOW - 6 * 60000 });
  assert.deepEqual([late.state, late.cumQty], ["cancelled", 1], "after 5 minutes the rest is not coming: a cancel with the real fill");
});

test("Richie's own requests survive a restart in the ledger, so the next quote still closes his stale ones", async () => {
  const { persistedMap } = await import("../src/live-sessions.mjs");
  const L = openLedger();
  persistedMap(L, "own_rfqs").set("KXMVE-OLD", { id: "old", at: NOW - 31 * 60000, contracts: 1 });
  const after = persistedMap(L, "own_rfqs");   // a new process reading the same ledger
  assert.deepEqual(after.get("KXMVE-OLD"), { id: "old", at: NOW - 31 * 60000, contracts: 1 });
  const ks = fakeKalshi({ [`GET /markets/${SPREAD.ticker}`]: { market: SPREAD }, [`GET /markets/${TOTAL.ticker}`]: { market: TOTAL }, "DELETE /communications/rfqs/": {},
    [`POST /multivariate_event_collections/${COMBO_COLLECTION}`]: { market_ticker: COMBO }, "POST /communications/rfqs": { id: "r2" }, "GET /communications/quotes": { quotes: [quote()] } });
  await parlayQuote(ks, { legs: [{ ticker: SPREAD.ticker, side: "yes" }, { ticker: TOTAL.ticker, side: "yes" }], contracts: 1 }, { sleep: async () => {}, now, own: after });
  assert.deepEqual(ks.calls.filter(c => c[0] === "DELETE").map(c => c[1]), ["/communications/rfqs/old"]);
  assert.deepEqual([...persistedMap(L, "own_rfqs").keys()], [COMBO]);
});

test("a parlay's edge is relative: 15% of its price after the fee; a single bet still needs 5 cents", async () => {
  const { kalshiCaseProblem, kalshiEdgeNeeded } = await import("../src/core/lib.mjs");
  const base = { side: "yes", thesis: "t", resolves: "r", invalidation: "i", sources: SRC };
  // Richie's 5 PM parlay on 2026-11-03: joint 0.0999 against a 0.086 quote is 0.4 cents after the fee, under 1.3.
  assert.match(kalshiCaseProblem({ ...base, ticker: COMBO, price: 0.086, fair: 0.0999 }), /edge after the fee is 0\.4 cents; it needs at least 1\.3 \(15% of the parlay's price\)/);
  assert.equal(kalshiCaseProblem({ ...base, ticker: COMBO, price: 0.086, fair: 0.11 }), null, "2.4 cents clears 1.3");
  assert.ok(Math.abs(kalshiEdgeNeeded(COMBO, 0.4) - 0.06) < 1e-9, "a dearer parlay needs more than 5 cents");
  assert.equal(kalshiEdgeNeeded(SPREAD.ticker, 0.086), 0.05);
  assert.match(kalshiCaseProblem({ ...base, ticker: SPREAD.ticker, price: 0.086, fair: 0.11 }), /needs at least 5\.0/);
});
