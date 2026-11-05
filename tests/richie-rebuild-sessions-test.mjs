// Richie rebuild: trading sessions and chat (src/sessions.mjs), the research budget and automatic
// promotion. Offline only: a scripted fake model and fake quotes; no broker, model or Keychain call.
import test from "node:test";
import assert from "node:assert/strict";
import { openLedger } from "../src/ledger.mjs";
import { importLegacy } from "../src/migrate.mjs";
import { handleProposal, kalshiSizing, kalshiCalibration, runSession, chatTurn, gateProblem, reviewer, openrouterModel } from "../src/sessions.mjs";
import { dispatch, fixtureProvider } from "../src/research.mjs";
import { promotionCheck } from "../src/strategy.mjs";

const NOW = Date.parse("2026-11-03T15:00:00Z"), now = () => NOW;
const SRC = ["https://example.com/quote", "https://example.com/news", "https://example.com/filing"];
const stockCase = (o = {}) => ({ instrument: "ABBV", instrumentType: "stock", side: "buy", quantity: 0.01, limitPrice: 284, entry: 284, stop: 270, target: 312,
  thesis: "Breakout on volume", invalidation: "Close under 275", sources: SRC, ...o });
const ledger = ({ cash = 40 } = {}) => {
  const L = openLedger();
  L.setAccount({ broker: "robinhood", cash, value: 120, source: "test", asOf: NOW });
  L.setAccount({ broker: "kalshi", cash: 3.63, value: 3.63, source: "test", asOf: NOW });
  return L;
};
const quotes = { "robinhood:ABBV": { price: 284.1 }, "kalshi:KXRAIN": { ask: 0.45, price: 0.45 } };
const liveQuote = async (broker, instrument) => quotes[`${broker}:${instrument}`] ?? null;
const neverAdapter = { place: async () => { throw Error("an adapter was called in observation mode"); } };

test("legacy gates run in code before any review: a made-up entry is refused unseen", async () => {
  let reviewed = 0;
  const out = await handleProposal(stockCase({ entry: 300 }), { ledger: ledger(), broker: "robinhood", review: async () => { reviewed++; return "PASS: x"; }, liveQuote, now, adapter: neverAdapter });
  assert.match(out, /^Not sent: the entry 300 is 5\.6% from the live price 284\.1/);
  assert.equal(reviewed, 0);
  assert.match(gateProblem({ ...stockCase({ entry: 284 }), broker: "robinhood" }, null), /could not read a live price/);
});

test("a passed buy is previewed, never sent, and only if the order rules allow it", async () => {
  const L = ledger();
  const seen = [];
  const out = await handleProposal(stockCase(), { ledger: L, broker: "robinhood", review: async c => { seen.push(c); return "PASS: concrete and near the live price"; }, liveQuote, now, adapter: neverAdapter });
  assert.equal(out, "Previewed, not sent (observation mode). The order passed the case gates and the review.");
  assert.equal(seen[0].livePrice, 284.1);
  assert.match(L.alerts().find(a => a.kind === "trade_preview").text, /^Watch-only: would buy 0\.01 ABBV at 284/);
  assert.equal(L.all("SELECT COUNT(*) AS n FROM orders")[0].n, 0, "no order row in observation");
  assert.equal(L.evidence()[0].verdict, "PASS: concrete and near the live price");
  // Over the cash: the preview is refused by the same rule a live order would be.
  const poor = await handleProposal(stockCase({ quantity: 1 }), { ledger: ledger({ cash: 40 }), broker: "robinhood", review: async () => "PASS: ok", liveQuote, now, adapter: neverAdapter });
  assert.match(poor, /^Not sent: That costs \$284\.00 with fees; only \$40\.00 cash/);
});

test("a failed or silent review stops the buy and is kept as evidence", async () => {
  const L = ledger();
  assert.match(await handleProposal(stockCase(), { ledger: L, broker: "robinhood", review: async () => "FAIL: no catalyst", liveQuote, now }), /^Not sent: the review said FAIL: no catalyst/);
  assert.match(await handleProposal(stockCase(), { ledger: L, broker: "robinhood", review: async () => { throw Error("timeout"); }, liveQuote, now }), /review did not answer/);
  assert.deepEqual(L.evidence().map(e => e.status), ["incomplete", "incomplete"]);
});

test("Kalshi keeps the 5-cent edge and the live-ask check; exits need no review", async () => {
  const L = ledger();
  L.setAccount({ broker: "kalshi", cash: 10, value: 10, source: "test", asOf: NOW });   // big enough for one contract at the playbook size
  const kal = o => ({ instrument: "KXRAIN", instrumentType: "event_contract", side: "buy", outcomeSide: "no", quantity: 2, limitPrice: 0.45, fair: 0.48,
    thesis: "Dry front", invalidation: "Radar shows rain", resolves: "Nov 4 NWS report", sources: SRC, ...o });
  assert.match(await handleProposal(kal(), { ledger: L, broker: "kalshi", review: async () => "PASS", liveQuote, now }), /edge after the fee is .* needs at least 5/);
  assert.match(await handleProposal(kal({ fair: 0.7, limitPrice: 0.4 }), { ledger: L, broker: "kalshi", review: async () => "PASS", liveQuote, now }), /not the live ask 0\.45/);
  assert.match(await handleProposal(kal({ fair: 0.7, quantity: 1 }), { ledger: L, broker: "kalshi", review: async () => "PASS: argued", liveQuote, now }), /^Previewed/);
  importLegacy(L, { held: { ABBV: { kind: "stock", quantity: 0.0141, dollars: 4, entry: 283.67, stop: 266 } } }, { now: NOW });
  let reviewed = 0;
  const exit = await handleProposal({ instrument: "ABBV", side: "sell", quantity: 0.0141, limitPrice: 284 }, { ledger: L, broker: "robinhood", review: async () => { reviewed++; return "FAIL"; }, liveQuote, now });
  assert.match(exit, /^Previewed/); assert.equal(reviewed, 0);
  assert.match(await handleProposal({ instrument: "ABBV", side: "sell", quantity: 1, limitPrice: 284 }, { ledger: L, broker: "robinhood", review: async () => "", liveQuote, now }), /more than the 0\.0141 held/);
  // Live, a session's sale carries its reason into the trade row and the lesson (it was booked as "sold").
  const { EXECUTION_LEASE } = await import("../src/execution.mjs");
  L.lease(EXECUTION_LEASE, "x", 60000, NOW);
  const adapter = { broker: "robinhood", place: async o => ({ state: "filled", cumQty: o.quantity, avgPrice: 284 }), lookup: async () => null, positions: async () => [] };
  assert.match(await handleProposal({ instrument: "ABBV", side: "sell", quantity: 0.0141, limitPrice: 284, thesis: "Broke its  20-day average on volume" },
    { ledger: L, broker: "robinhood", review: async () => "FAIL", liveQuote, now, mode: "live", owner: "x", adapter }), /^Order filled/);
  assert.equal(L.trades(false)[0].why, "Broke its 20-day average on volume");
});

// The first live bet (2026-11-02): NO on KXNYCSUBWAY at 93c, 6 contracts, 3 sources, chance 0.995, Kalshi worth $10.63.
// Sized by the playbook rule it is 1.31 contracts (quarter Kelly halved for under 5 sources), 2.62 with 5 sources.
test("Kalshi size: a quarter of Kelly from the stated chance and price with fee, halved under 5 sources", async () => {
  const L = ledger();
  L.setAccount({ broker: "kalshi", cash: 10.63, value: 10.63, source: "test", asOf: NOW });
  const s3 = kalshiSizing({ fair: 0.995, price: 0.93, quantity: 6, sources: SRC, accountValue: 10.63 });
  assert.deepEqual([Number(s3.kelly.toFixed(3)), Number(s3.fraction.toFixed(4)), s3.maxContracts], [0.923, 0.1154, 1.31]);
  assert.equal(kalshiSizing({ fair: 0.995, price: 0.93, quantity: 6, sources: [...SRC, "a", "b"], accountValue: 10.63 }).maxContracts, 2.62);
  assert.equal(kalshiSizing({ fair: 0.9, price: 0.93, quantity: 1, sources: SRC, accountValue: 10.63 }).maxContracts, 0);   // no edge, no size
  const bet = o => ({ instrument: "KXNYCSUBWAY-26OCT31-A4500000", instrumentType: "event_contract", side: "buy", outcomeSide: "no", quantity: 6, limitPrice: 0.93, fair: 0.995,
    thesis: "Month averages 4.40M over 20 weekdays", invalidation: "MTA revises up", resolves: "MTA October average, Nov 2", sources: SRC, ...o });
  const quote = async () => ({ price: 0.93, ask: 0.93, bid: 0.92 });
  assert.match(await handleProposal(bet(), { ledger: L, broker: "kalshi", review: async () => "PASS", liveQuote: quote, now }), /above the playbook size .* at most 1.31 contracts/);
  assert.match(await handleProposal(bet({ quantity: 1 }), { ledger: L, broker: "kalshi", review: async () => "PASS", liveQuote: quote, now }), /^Previewed/);
});

test("a Kalshi bet refused in a session cannot come back with a higher chance unless it cites something new", async () => {
  const L = ledger();
  L.setAccount({ broker: "kalshi", cash: 10.63, value: 10.63, source: "test", asOf: NOW });
  const refused = new Map(), quote = async () => ({ price: 0.93, ask: 0.93, bid: 0.92 });
  const bet = o => ({ instrument: "KXNYCSUBWAY-26OCT31-A4500000", instrumentType: "event_contract", side: "buy", outcomeSide: "no", quantity: 1, limitPrice: 0.93,
    thesis: "Month averages 4.40M over 20 weekdays", invalidation: "MTA revises up", resolves: "MTA October average, Nov 2", sources: SRC, ...o });
  const go = o => handleProposal(bet(o), { ledger: L, broker: "kalshi", review: async () => "PASS", liveQuote: quote, now, refused });
  assert.match(await go({ fair: 0.99 }), /needs at least 5/);                          // as live: just under the edge
  assert.match(await go({ fair: 0.995 }), /refused at a chance of 0\.99 .* not cited yet/);   // as live: same case, number raised
  assert.match(await go({ fair: 0.995, sources: [...SRC, "https://new.mta.info/agency/new-york-city-transit/subway-bus-ridership-2026"] }), /^Previewed/);
});

test("Kalshi calibration: settled bets score the stated chance, and size shrinks only from 5 settled bets", async () => {
  const L = ledger();
  L.setAccount({ broker: "kalshi", cash: 10.63, value: 10.63, source: "test", asOf: NOW });
  const settle = (i, won, fair = 0.95) => {
    const clientId = `c${i}`, instrument = `KXT-${i}`;
    L.saveEvidence({ id: `e${i}`, subject: instrument, role: "case", verdict: "PASS", status: "complete", createdAt: NOW, packet: { fair, side: "no" } });
    L.recordIntent({ clientId, broker: "kalshi", instrument, instrumentType: "event_contract", side: "buy", outcomeSide: "no", quantity: 1, limitPrice: 0.9, evidenceId: `e${i}` }, NOW);
    L.applyFill({ clientId, fillKey: `f${i}`, qty: 1, price: 0.9, at: NOW });
    L.settlePosition(`kalshi:${instrument}:no`, { payout: won ? 1 : 0, result: won ? "no" : "yes", at: NOW + i });
  };
  assert.match(kalshiCalibration(L).line, /no settled bets yet/);
  for (let i = 0; i < 4; i++) settle(i, i !== 0);   // one 95% call lost
  let c = kalshiCalibration(L);
  assert.deepEqual([c.n, Number(c.score.toFixed(4)), c.multiplier], [4, 0.2275, 1]);   // too few to act on
  settle(4, false);                                 // two of five lost: overconfident
  c = kalshiCalibration(L);
  assert.deepEqual([c.n, Number(c.score.toFixed(4)), c.multiplier], [5, 0.3625, 0.25]);
  assert.equal(kalshiSizing({ fair: 0.995, price: 0.93, quantity: 1, sources: SRC, accountValue: 10.63, calibration: c.multiplier }).maxContracts, 0.32);
  const out = await handleProposal({ instrument: "KXNEW", instrumentType: "event_contract", side: "buy", outcomeSide: "no", quantity: 1.31, limitPrice: 0.93, fair: 0.995,
    thesis: "t", invalidation: "i", resolves: "r", sources: SRC }, { ledger: L, broker: "kalshi", review: async () => "PASS", liveQuote: async () => ({ price: 0.93, ask: 0.93 }), now });
  assert.match(out, /x0\.25 for calibration\), so at most 0\.32 contracts/);
});

// A scripted model: each call returns the next message.
const scripted = steps => { const seen = []; const m = async (messages, tools) => { seen.push({ messages: messages.slice(), tools: tools.map(t => t.function.name) }); return steps.shift(); }; m.seen = seen; return m; };
const call = (name, args, id = name) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });

test("a session: look tools, one proposal through every check, and a summary", async () => {
  const L = ledger();
  const model = scripted([{ role: "assistant", tool_calls: [call("quote", { symbol: "ABBV" })] }, { role: "assistant", tool_calls: [call("propose_trade", stockCase())] },
    { role: "assistant", content: "Previewed a small ABBV buy on the breakout; nothing else qualified." }]);
  const quote = { def: { name: "quote", description: "Live quote", parameters: { type: "object", properties: { symbol: { type: "string" } } } }, run: async () => "ABBV 284.10" };
  const r = await runSession({ ledger: L, broker: "robinhood", model, review: async () => "PASS: fine", lookTools: { quote }, liveQuote, strategy: { version: "v1", text: "momentum" }, nowText: "Nov 3, 10:00", now, adapter: neverAdapter });
  assert.deepEqual(r.used, ["quote", "propose_trade"]);
  assert.match(r.proposals[0].out, /^Previewed/);
  assert.equal(r.summary, "Previewed a small ABBV buy on the breakout; nothing else qualified.");
  assert.deepEqual(model.seen[0].tools.sort(), ["propose_trade", "quote"]);
  assert.match(model.seen[0].messages[0].content, /robinhood cash \$40\.00/);
});

test("chat has look tools and start_session, never a trade action", async () => {
  const model = scripted([{ role: "assistant", tool_calls: [call("start_session", { broker: "kalshi", request: "look at rain markets" })] }, { role: "assistant", content: "Starting a Kalshi session now." }]);
  const out = await chatTurn({ ledger: ledger(), model, text: "check kalshi rain", nowText: "Nov 3" });
  assert.deepEqual(out.requested, { broker: "kalshi", request: "look at rain markets" });
  assert.ok(!model.seen[0].tools.includes("propose_trade"));
  assert.match(model.seen[0].messages[0].content, /outside what I handle/);
  // A tool the model invents is refused, not run.
  const bad = scripted([{ role: "assistant", tool_calls: [call("place_equity_order", {})] }, { role: "assistant", content: "Can't do that here." }]);
  await chatTurn({ ledger: ledger(), model: bad, text: "buy now", nowText: "Nov 3" });
  assert.match(bad.seen[1].messages.at(-1).content, /no tool place_equity_order/);
});

test("the reviewer and OpenRouter adapter: one line back, cost reported, no key in the body", async () => {
  let body, cost = 0;
  const fetcher = async (url, opts) => { body = JSON.parse(opts.body); return Response.json({ choices: [{ message: { content: "PASS: fine" } }], usage: { cost: 0.0021 } }); };
  const m = openrouterModel({ key: "sk-test", model: "deepseek/x", fetcher, onCost: c => { cost += c; } });
  assert.equal(await reviewer(m)({ instrument: "ABBV" }), "PASS: fine");
  assert.equal(cost, 0.0021); assert.ok(!JSON.stringify(body).includes("sk-test")); assert.equal(body.tools, undefined);
});

test("research stops for the day at the owner's $0.25 and counts what each worker cost", async () => {
  const packet = { recommendation: "supports", items: [{ source: "https://example.com/a", observedAt: NOW, unknowns: [] }], countercase: "x", assumptions: [], cost: 0.03 };
  let spent = 0.2;
  const opts = { provider: fixtureProvider({ a: { packet }, b: { packet: { ...packet } } }), now, spent: () => spent, record: c => { spent += c; } };
  const first = await dispatch([{ id: "a", subject: "ABBV", role: "news", question: "q1", validityMs: 3600000 }, { id: "b", subject: "ABBV", role: "filings", question: "q2", validityMs: 3600000 }], opts);
  assert.deepEqual(first.map(r => r.status), ["complete", "complete"]);
  assert.ok(Math.abs(spent - 0.26) < 1e-9);
  const after = await dispatch([{ id: "a", subject: "XLE", role: "news", question: "q3", validityMs: 3600000 }], opts);
  assert.deepEqual(after.map(r => [r.status, r.problems[0]]), [["skipped", "today's research budget is spent"]]);
});

test("a version reaches the owner for approval only when it meets every promotion criterion", () => {
  const good = { count: 34, netReturn: 0.08, maxDrawdown: 0.12 };
  assert.deepEqual(promotionCheck(good, { benchmark: 0.05, missedRate: 0.01 }), { pass: true, reasons: [] });
  const r = promotionCheck({ count: 12, netReturn: 0.02, maxDrawdown: 0.3 }, { benchmark: 0.05, missedRate: 0.08 });
  assert.equal(r.pass, false);
  assert.equal(r.reasons.length, 4);
  assert.match(r.reasons.join("; "), /12 trades, needs 30; net 2\.00% does not beat buy and hold 5\.00%; max drawdown 30\.0% is over 25%; 8\.0% of checks missed/);
});

// The owner, 2026-11-02, asked SPY or VOO for the core: "Keep in cash". A core buy is refused before any review.
test("core buys are refused: idle cash stays in cash", async () => {
  const L = ledger();
  const core = o => ({ instrument: "SPY", instrumentType: "etf", side: "buy", role: "core", notional: 10, entry: 580, thesis: "Idle cash per the playbook", invalidation: "n/a", sources: [], ...o });
  const quotes2 = async (b, i) => i === "SPY" ? { price: 580.4 } : liveQuote(b, i);
  let reviewed = 0;
  for (const c of [core(), core({ instrument: "VOO" })])
    assert.match(await handleProposal(c, { ledger: L, broker: "robinhood", review: async () => { reviewed++; return "PASS"; }, liveQuote: quotes2, now, adapter: neverAdapter }), /idle cash stays in cash/);
  assert.equal(reviewed, 0); assert.equal(L.openOrders().length, 0);
});

test("a session that runs out of steps still ends with a summary", async () => {
  const L = ledger();
  const quote = { def: { name: "quote", description: "q", parameters: { type: "object", properties: {} } }, run: async () => "ok" };
  let calls = 0;
  const model = async (messages, tools) => { calls++; return tools.length ? { role: "assistant", tool_calls: [{ id: `c${calls}`, type: "function", function: { name: "quote", arguments: "{}" } }] } : { role: "assistant", content: "Looked at quotes; nothing qualified." }; };
  const r = await runSession({ ledger: L, broker: "kalshi", model, review: async () => "PASS", lookTools: { quote }, liveQuote, strategy: { version: "v", text: "t" }, nowText: "now", now });
  assert.equal(r.summary, "Looked at quotes; nothing qualified.");
  assert.equal(r.used.length, 24);
});

test("research workers: read tools only, sourced packets saved as evidence, the day's budget respected", async () => {
  const { researchTool, workerProvider } = await import("../src/live-sessions.mjs");
  const L = ledger();
  const tools = { web_read: { def: { name: "web_read", description: "read", parameters: { type: "object", properties: { url: { type: "string" } } } }, run: async () => "CPI preview: economists expect 0.3%" },
    propose_trade: { def: { name: "propose_trade", description: "x", parameters: { type: "object", properties: {} } }, run: async () => { throw Error("a worker reached propose_trade"); } } };
  // A scripted worker: one page read, then the packet.
  let step = 0;
  const fetcher = async (url, opts) => {
    const body = JSON.parse(opts.body);
    assert.ok(!(body.tools || []).some(t => t.function.name === "propose_trade"), "workers never see trade tools");
    const msg = step++ % 2 === 0 ? { role: "assistant", tool_calls: [{ id: "c1", type: "function", function: { name: "web_read", arguments: '{"url":"https://example.com/cpi"}' } }] }
      : { role: "assistant", content: '{"recommendation":"supports","items":[{"fact":"Consensus 0.3% m/m","source":"https://example.com/cpi","unknowns":["core"]}],"countercase":"Energy prices fell","assumptions":[]}' };
    return Response.json({ choices: [{ message: msg }], usage: { cost: 0.01 } });
  };
  const real = globalThis.fetch; globalThis.fetch = fetcher;
  try {
    const t = researchTool({ ledger: L, key: "k", tools, onCost: () => {}, now });
    const out = await t.run({ tasks: [{ subject: "KXCPI", question: "What does consensus expect for October CPI?" }] });
    assert.match(out, /^KXCPI: complete, supports\. Consensus 0\.3% m\/m \(https:\/\/example\.com\/cpi\) Countercase: Energy prices fell/);
    assert.equal(L.evidence().find(e => e.role === "research").subject, "KXCPI");
    assert.ok(Math.abs(Number(L.meta(`research_spend:2026-11-03`)) - 0.02) < 1e-9, "both worker calls counted");
    // A worker that fails (here: no JSON packet) was paid for too; its spend used to be dropped.
    step = 1;
    globalThis.fetch = async () => Response.json({ choices: [{ message: { role: "assistant", content: "I could not find anything." } }], usage: { cost: 0.01 } });
    assert.match(await t.run({ tasks: [{ subject: "KXCPI", question: "Anything new?" }] }), /incomplete/);
    assert.ok(Math.abs(Number(L.meta(`research_spend:2026-11-03`)) - 0.03) < 1e-9, "a failed worker's call counted");
    L.meta("research_spend:2026-11-03", 0.25);
    assert.match(await t.run({ tasks: [{ subject: "X", question: "y" }] }), /today's research budget is spent/);
  } finally { globalThis.fetch = real; }
  assert.equal(typeof workerProvider, "function");
});

test("chat sees Richie's own order records, refusals included", async () => {
  const L = ledger();
  L.recordIntent({ clientId: "d1", broker: "robinhood", instrument: "DVN", instrumentType: "stock", side: "sell", quantity: 0.039494 }, 1);
  L.setOrderState("d1", "rejected", { reason: "Limit order quantity cannot include fractional shares." }, 2);
  let system = "";
  await chatTurn({ ledger: L, model: async m => { system = m[0].content; return { role: "assistant", content: "ok" }; }, text: "any errors?", nowText: "now" });
  assert.match(system, /Your own order records.*sell DVN rejected \(Limit order quantity cannot include fractional shares\.\)/);
});

// A fractional share count goes to Robinhood at market. Its limit price bounds nothing, so the cash check must not
// price the buy under the live price.
test("a fractional buy at market is cash-checked at the live price when its limit is lower", async () => {
  const { EXECUTION_LEASE } = await import("../src/execution.mjs");
  const L = ledger({ cash: 2.84 }), sent = [];
  L.lease(EXECUTION_LEASE, "x", 60000, NOW);
  const adapter = { broker: "robinhood", place: async o => { sent.push(o); return { state: "filled", cumQty: o.quantity, avgPrice: 284.1 }; }, lookup: async () => null, positions: async () => [] };
  const run = c => handleProposal(c, { ledger: L, broker: "robinhood", review: async () => "PASS: ok", liveQuote, now, mode: "live", owner: "x", adapter });
  assert.match(await run(stockCase({ quantity: 0.01, limitPrice: 280, entry: 284 })), /^Not sent: That costs \$2\.84 with fees; only \$2\.84 cash/);
  assert.equal(sent.length, 0);
  L.setAccount({ broker: "robinhood", cash: 3, value: 120, source: "test", asOf: NOW });
  assert.match(await run(stockCase({ quantity: 0.01, limitPrice: 280, entry: 284 })), /^Order filled/);
  assert.equal(sent[0].limitPrice, 284.1); assert.equal(sent[0].orderType, "market");
});

// A stock market order placed after hours waits for the open and can fill on a gap above the checked price (margin).
test("stock and ETF buys are refused while the market is closed; crypto is not", async () => {
  const evening = () => Date.parse("2026-11-04T02:00:00Z");   // Tuesday 21:00 Eastern, the crypto session
  let reviewed = 0;
  const review = async () => { reviewed++; return "PASS: x"; };
  for (const instrumentType of ["stock", "etf"]) {
    const out = await handleProposal(stockCase({ instrumentType }), { ledger: ledger(), broker: "robinhood", review, liveQuote, now: evening, adapter: neverAdapter });
    assert.match(out, /^Not sent: the stock market is closed/, instrumentType);
  }
  assert.equal(reviewed, 0, "refused before the review spends anything");
  const btc = { instrument: "BTC", instrumentType: "crypto", side: "buy", quantity: 0.0001, limitPrice: 70000, entry: 70000, stop: 65000, target: 80000, thesis: "t", invalidation: "i", sources: SRC };
  const out = await handleProposal(btc, { ledger: ledger(), broker: "robinhood", review, liveQuote: async () => ({ price: 70010 }), now: evening, adapter: neverAdapter });
  assert.doesNotMatch(out, /market is closed/);
  const held = ledger(); importLegacy(held, { held: { ABBV: { kind: "stock", quantity: 0.0141, dollars: 4, entry: 283.67, stop: 266 } } }, { now: NOW });
  assert.doesNotMatch(await handleProposal({ instrument: "ABBV", side: "sell", quantity: 0.0141, limitPrice: 284 }, { ledger: held, broker: "robinhood", review, liveQuote, now: evening }), /market is closed/, "sales are not blocked");
});
