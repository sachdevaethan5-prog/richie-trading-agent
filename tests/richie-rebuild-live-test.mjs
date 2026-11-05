// Richie live (src/live.mjs and the runner's live exits). Offline: fake brokers and Telegram only.
import test from "node:test";
import assert from "node:assert/strict";
import { openLedger } from "../src/ledger.mjs";
import { importLegacy } from "../src/migrate.mjs";
import { scheduler } from "../src/monitor.mjs";
import { EXECUTION_LEASE } from "../src/execution.mjs";
import { robinhoodAdapter } from "../src/adapters/brokers.mjs";
import { robinhoodReader } from "../src/adapters/readers.mjs";
import { observerJobs } from "../src/runner.mjs";
import { tradingRobinhood, command, statusText } from "../src/live.mjs";
import { toolKind } from "../src/core/lib.mjs";

const T0 = Date.parse("2026-11-03T15:00:00Z");   // Tuesday 10:00 Eastern
const J = data => JSON.stringify({ data });

function fakeRh({ abbv = 260, placeState = "queued" } = {}) {
  const placed = [];
  const answers = {
    get_portfolio: () => J({ total_value: "10.3", cash: "0.02" }),
    get_equity_quotes: () => J({ results: [{ quote: { symbol: "ABBV", last_trade_price: String(abbv), updated_at: new Date(T0).toISOString() } }] }),
    get_equity_positions: () => J({ results: [{ symbol: "ABBV", quantity: "0.014091" }] }),
    get_crypto_positions: () => J({ results: [] }), get_equity_orders: () => J({ results: [] }), get_crypto_orders: () => J({ results: [] }),
    get_equity_historicals: () => J({ results: [] }),
    place_equity_order: a => { placed.push(a); return J({ id: "rh-1", state: placeState, cumulative_quantity: "0" }); },
  };
  return { placed, call: async (n, a) => { if (!answers[n]) throw Error(`fake has no ${n}`); return answers[n](a); } };
}
function setup({ rh = fakeRh(), owner = "live-test", leaseOwner = owner, telegram = null } = {}) {
  const L = openLedger();
  importLegacy(L, { held: { ABBV: { kind: "stock", quantity: 0.014091, dollars: 4, entry: 283.9, stop: 266, target: 320 } } }, { now: T0 - 1000 });
  L.lease(EXECUTION_LEASE, leaseOwner, 120000, T0);
  const account = { account_number: "ACCT" }, trade = tradingRobinhood(rh, toolKind);
  const adapters = { robinhood: robinhoodAdapter(trade, account) };
  const exec = { mode: "live", owner, adapters, paused: async () => L.meta("paused") === "1" };
  const jobs = observerJobs({ ledger: L, readers: { robinhood: robinhoodReader(trade, account, { now: () => T0 }) }, adapters, telegram, now: () => T0, exec });
  return { L, rh, sched: scheduler({ ledger: L, jobs, now: () => T0 }) };
}

test("a stop hit is sold live at market for the whole position, once", async () => {
  const { L, rh, sched } = setup();
  await Promise.all(sched.tick());
  assert.equal(rh.placed.length, 1);
  assert.deepEqual({ ...rh.placed[0], ref_id: "x" }, { account_number: "ACCT", symbol: "ABBV", side: "sell", ref_id: "x", quantity: "0.014091", type: "market", time_in_force: "gfd", market_hours: "regular_hours" });
  const o = L.openOrders()[0];
  assert.equal(o.state, "submitted"); assert.equal(o.order_type, "market"); assert.equal(o.client_id, rh.placed[0].ref_id);
  // The next pass sees the unresolved sell and sends nothing more.
  for (const j of L.jobs()) L.run("UPDATE jobs SET last_started_at = 0 WHERE name = ?", j.name);
  await Promise.all(sched.tick());
  assert.equal(rh.placed.length, 1);
});

test("pause never stops an exit; without the lease nothing is sent", async () => {
  const paused = setup();
  paused.L.meta("paused", "1");
  await Promise.all(paused.sched.tick());
  assert.equal(paused.rh.placed.length, 1);
  const other = setup({ leaseOwner: "someone-else" });
  await Promise.all(other.sched.tick());
  assert.equal(other.rh.placed.length, 0);
  assert.match(other.L.alerts().find(a => a.kind === "exit_blocked").text, /does not hold the execution lease/);
});

test("no exit above the stop; order messages go to Telegram", async () => {
  const quiet = setup({ rh: fakeRh({ abbv: 280 }) });
  await Promise.all(quiet.sched.tick());
  assert.equal(quiet.rh.placed.length, 0);
  const sent = [];
  let at = T0;
  const s = setup({ telegram: { send: async (t, k) => { sent.push([k, t]); return { delivered: true }; } } });
  await Promise.all(s.sched.tick());
  for (const j of s.L.jobs()) s.L.run("UPDATE jobs SET last_started_at = 0 WHERE name = ?", j.name);
  await Promise.all(s.sched.tick());
  assert.ok(sent.some(([k, t]) => k === "order" && /^Sell submitted: 0\.014091 ABBV at market\. Waiting on the fill/.test(t)), JSON.stringify(sent));
});

test("live Robinhood handle: reads and orders only, never cancels, transfers or options", async () => {
  const rh = tradingRobinhood({ call: async n => n }, toolKind);
  assert.equal(await rh.call("get_portfolio", {}), "get_portfolio");
  assert.equal(await rh.call("place_equity_order", {}), "place_equity_order");
  for (const n of ["cancel_equity_order", "place_option_order", "review_equity_order", "transfer_funds"]) await assert.rejects(rh.call(n, {}), /does not call/);
});

test("commands: status, pause and resume in code; anything else goes to chat", async () => {
  const { L } = setup();
  L.setAccount({ broker: "robinhood", cash: 0.02, value: 10.31, source: "t", asOf: Date.now() });
  assert.match(await command("status", { ledger: L, chat: async () => "x" }), /^Robinhood \$10\.31 \(cash \$0\.02\)\. Positions: ABBV 0\.014091 /);
  assert.match(await command("Status?", { ledger: L, chat: async () => "x" }), /^Robinhood \$10\.31/);
  assert.match(await command("pause", { ledger: L, chat: async () => "x" }), /^Paused new buys/);
  assert.match(statusText(L), /Paused: no new buys; exits still run\./);
  assert.match(await command("Resume", { ledger: L, chat: async () => "x" }), /^Resumed/);
  assert.equal(await command("how is XLE doing?", { ledger: L, chat: async t => `chat: ${t}` }), "chat: how is XLE doing?");
});

test("session schedule matches the legacy bot, in Eastern time", async () => {
  const { sessionDue } = await import("../src/live-sessions.mjs");
  const at = iso => sessionDue(Date.parse(iso));
  assert.deepEqual(at("2026-11-03T15:30:00Z"), { broker: "robinhood", kind: "stocks", stamp: "2026-11-03 10:30" });   // Tue 10:30 EST
  assert.equal(at("2026-11-03T20:00:00Z").kind, "stocks");                                                          // 15:00
  assert.equal(at("2026-11-07T15:30:00Z"), null);                                                                    // Saturday 10:30
  assert.equal(at("2026-11-03T02:00:00Z").kind, "crypto");                                                           // Mon 21:00
  assert.equal(at("2026-11-04T02:00:00Z"), null);                                                                    // Tue 21:00: no crypto session
  assert.equal(at("2026-11-07T17:00:00Z").kind, "Kalshi");                                                           // Sat 12:00, every day
  assert.equal(at("2026-11-03T15:31:00Z"), null);
});

test("look tools: Robinhood reads only, account numbers filled by code, page text flagged when it gives orders", async () => {
  const { lookTools } = await import("../src/live-sessions.mjs");
  const calls = [];
  const rh = { call: async (n, a) => { calls.push([n, a]); return J({ total_value: "10" }); } };
  const tools = lookTools({ rh, ready: async () => {}, account: { account_number: "ACCT", rhs_account_number: "RHS" }, ks: null });
  assert.match(await tools.robinhood_read.run({ tool: "place_equity_order", args: {} }), /not a look-only tool/);
  await tools.robinhood_read.run({ tool: "get_portfolio", args: { account_number: "model-chose-this" } });
  await tools.robinhood_read.run({ tool: "get_crypto_positions", args: {} });
  assert.deepEqual(calls, [["get_portfolio", { account_number: "ACCT" }], ["get_crypto_positions", { rhs_account_number: "RHS" }]]);
  assert.ok(!("kalshi_markets" in tools));
  assert.match(await tools.web_read.run({ url: "http://example.com" }), /only https/);
});

test("strategy summary: the playbook scored as a whole portfolio beside SPY and the SPY-core version, sections, decisions", async () => {
  const { strategySummary, momentumSignal, researchItem } = await import("../src/live-sessions.mjs");
  const day = i => Date.parse("2025-09-01") + i * 86400000;
  // AAA climbs with a volume spike every 30 days, so the rule fires and the target is reached; SPY drifts up.
  const AAA = Array.from({ length: 300 }, (_, i) => { const c = 100 * 1.004 ** i; return { t: day(i), o: c * 0.999, h: c * 1.01, l: c * 0.995, c, v: i % 30 === 29 ? 3000 : 1000 }; });
  const SPY = Array.from({ length: 300 }, (_, i) => { const c = 400 * 1.0005 ** i; return { t: day(i), o: c, h: c * 1.002, l: c * 0.998, c, v: 1 }; });
  assert.equal(momentumSignal(AAA.slice(0, 40), 39), null, "needs 50 bars of history");
  const s = strategySummary({ series: { AAA, SPY }, playbook: "# Playbook\n## Core\n- Idle cash in SPY.\n## Satellite\n- Momentum with stops.", missedRate: 0.01 });
  assert.equal(s.version, "cash-satellite-1"); assert.equal(s.sample, false);
  assert.deepEqual(s.sections, [{ title: "Core", items: ["Idle cash in SPY."] }, { title: "Satellite", items: ["Momentum with stops."] }]);
  assert.ok(s.evaluation.count > 0);
  assert.ok(s.evaluation.netReturn > s.evaluation.benchmark, "the satellite beats a slow SPY here");
  assert.match(s.evaluation.report, /^cash-satellite-1: up to 3 momentum satellites with idle cash in cash, 1 names/);
  assert.match(s.evaluation.report, /With an SPY core \(not used, the owner keeps cash\):/);
  assert.match(s.evaluation.report, /Promotion check: does not pass \(.*trades, needs 30/);
  assert.equal(s.gatesTitle, "Entry Gates (Kept Live)");
  assert.match(s.openDecisions[0], /DeepSeek PASS for every buy/);
  // Research trail items: a web page links to itself, a Robinhood read has no link.
  assert.equal(researchItem("web_read", { url: "https://example.com/a" }, "text", 1).source, "https://example.com/a");
  assert.equal(researchItem("robinhood_read", { tool: "get_equity_quotes", args: { symbols: ["XLE"] } }, "{}", 1).source, "");
  assert.equal(researchItem("propose_trade", { side: "buy", instrument: "SPY", role: "core" }, "Previewed", 1).label, "Proposed: buy SPY (core)");
  assert.equal(researchItem("skill_read", {}, "", 1), null);
  // Steps read as words, and a failed call is marked.
  const q = researchItem("robinhood_read", { tool: "get_equity_quotes", args: { symbols: ["ABBV", "XLE", "DVN"] } }, '{"data":{}}', 1);
  assert.equal(q.label, "Robinhood: stock quotes for ABBV, XLE, DVN"); assert.equal(q.ok, true);
  const bad = researchItem("robinhood_read", { tool: "get_equity_historicals", args: { symbols: ["XLE"], span: "3month" } }, "Error: Robinhood: invalid params: validating arguments", 1);
  assert.equal(bad.ok, false); assert.match(bad.result, /invalid params/);
  assert.equal(researchItem("web_read", { url: "https://www.clevelandfed.org/x" }, "text", 1).label, "Read clevelandfed.org");
});

test("paper book: a passed-on setup is tracked and closed at its stop as a paper trade", async () => {
  const { paperTool, checkPaper } = await import("../src/live-sessions.mjs");
  const L = openLedger();
  let t = T0;
  const tool = paperTool(L, () => t);
  assert.match(tool.run({ symbol: "MU", entry: 100, stop: 120, target: 130, why_not: "x" }), /refused/);
  assert.match(tool.run({ symbol: "MU", kind: "stock", entry: 100, stop: 93, target: 114, why_not: "below the 20-day" }), /^MU is on paper/);
  assert.match(tool.run({ symbol: "MU", entry: 100, stop: 93, target: 114, why_not: "again" }), /already on paper/);
  let price = 101;
  const quote = async () => ({ price });
  assert.equal(await checkPaper({ ledger: L, quote, open: () => true, now: () => t }), 0);
  price = 92; t += 3600000;
  assert.equal(await checkPaper({ ledger: L, quote, open: () => false, now: () => t }), 0, "stocks wait for market hours");
  assert.equal(await checkPaper({ ledger: L, quote, open: () => true, now: () => t }), 1);
  const paper = L.trades(true)[0];
  assert.equal(paper.why, "stop"); assert.ok(Math.abs(paper.ret + 0.08) < 1e-9);
  assert.equal(JSON.parse(L.meta("paper")).length, 0);
  assert.match(statusText(L), /Paper: 1 closed, 0 won/);
  // A setup put on paper by a session while the pass waits on a quote survives the pass.
  tool.run({ symbol: "AMD", kind: "stock", entry: 100, stop: 93, target: 114, why_not: "thin volume" });
  const slow = async () => { tool.run({ symbol: "NVDA", kind: "stock", entry: 100, stop: 93, target: 114, why_not: "no fresh high" }); return { price: 101 }; };
  assert.equal(await checkPaper({ ledger: L, quote: slow, open: () => true, now: () => t }), 0);
  assert.deepEqual(JSON.parse(L.meta("paper")).map(p => p.symbol), ["AMD", "NVDA"]);
});

test("weekly review answer: lessons and proposed changes are split; commands reach the journal and sessions", async () => {
  const { splitReview } = await import("../src/live-sessions.mjs");
  assert.deepEqual(splitReview("Intro\n## Lessons\n- Keep the trend filter.\n## Proposed rule changes\n- Test a 6% stop: 3 of 4 stops were 6 to 7% away."),
    { lessons: "- Keep the trend filter.", changes: "- Test a 6% stop: 3 of 4 stops were 6 to 7% away." });
  assert.equal(splitReview("no sections"), null);
  const { L } = setup(), seen = [];
  const ctx = { ledger: L, chat: async () => "chat", journal: async b => `journal ${b}`, start: b => { seen.push(b); return `start ${b}`; } };
  assert.equal(await command("Journal", ctx), "journal robinhood");
  assert.equal(await command("kalshi journal", ctx), "journal kalshi");
  assert.equal(await command("run", ctx), "start robinhood");
  assert.equal(await command("kalshi now", ctx), "start kalshi");
  assert.deepEqual(seen, ["robinhood", "kalshi"]);
});

test("market calendar: holidays and early closes", async () => {
  const { marketOpen } = await import("../src/runner.mjs");
  const { sessionDue } = await import("../src/live-sessions.mjs");
  assert.equal(marketOpen(Date.parse("2026-11-26T15:00:00Z")), false, "Thanksgiving");
  assert.equal(marketOpen(Date.parse("2026-11-27T17:30:00Z")), true, "12:30 on the early-close day");
  assert.equal(marketOpen(Date.parse("2026-11-27T18:30:00Z")), false, "13:30 after the early close");
  assert.equal(sessionDue(Date.parse("2026-11-26T15:30:00Z")), null, "no stock session on a holiday");
  assert.equal(sessionDue(Date.parse("2026-11-27T20:00:00Z")), null, "no 15:00 session after an early close");
  assert.equal(sessionDue(Date.parse("2026-11-27T17:30:00Z")).kind, "stocks", "12:30 instead");
});

test("ledger backup: a readable copy per day, 14 kept", async () => {
  const { backupLedger } = await import("../src/runner.mjs");
  const { mkdtemp, writeFile, readdir } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "richie-backup-")), L = openLedger(join(dir, "live.db"));
  L.meta("x", "1");
  for (let d = 1; d <= 15; d++) await writeFile(join(dir, `ledger-2026-10-${String(d).padStart(2, "0")}.db`), "");
  const file = await backupLedger(L, dir, T0);
  assert.equal(openLedger(file, { readOnly: true }).meta("x"), "1");
  assert.equal((await readdir(dir)).filter(f => f.startsWith("ledger-")).length, 14);
});

test("close rules: under the 20-day near the close sells; the time limit spares legacy buys and the core", async () => {
  const { closeRuleExit, closeRules } = await import("../src/runner.mjs");
  const day = i => Date.parse("2026-10-01T20:00:00Z") + i * 86400000;
  const bars = Array.from({ length: 30 }, (_, i) => ({ t: day(i), o: 100, h: 101, l: 99, c: 100 }));
  const now = Date.parse("2026-11-03T20:52:00Z");   // 15:52 Eastern
  const pos = (plan, opened = day(0)) => ({ broker: "robinhood", instrument_type: "stock", opened_at: opened, plan: JSON.stringify(plan) });
  assert.equal(closeRuleExit(pos({ stop: 90, source: "session case" }), 98, bars, now), "close under the 20-day average");
  assert.equal(closeRuleExit(pos({ stop: 90, source: "session case" }), 102, bars, now), "20 trading days");
  assert.equal(closeRuleExit(pos({ stop: 90, source: "legacy case" }), 102, bars, now), null, "legacy positions keep no time limit");
  assert.equal(closeRuleExit(pos({ role: "core" }), 50, bars, now), null, "the core has no exit rule");
  // Live: one market sell near the close, once a day.
  const { L, rh } = setup({ rh: fakeRh({ abbv: 270 }) });
  L.meta("candles:robinhood:ABBV:long", JSON.stringify({ bars: Array.from({ length: 25 }, (_, i) => ({ t: Date.parse("2026-10-01T20:00:00Z") + i * 86400000, o: 285, h: 286, l: 284, c: 285 })) }));
  L.setQuote({ broker: "robinhood", instrument: "ABBV", price: 270, source: "t", asOf: now });
  L.lease(EXECUTION_LEASE, "live-test", 120000, now);
  const exec = { mode: "live", owner: "live-test", adapters: { robinhood: robinhoodAdapter(tradingRobinhood(rh, toolKind), { account_number: "ACCT" }) }, paused: async () => false };
  assert.deepEqual(await closeRules({ ledger: L, exec, now: () => Date.parse("2026-11-03T20:40:00Z"), open: () => true }), [], "not before 15:50");
  const sent = await closeRules({ ledger: L, exec, now: () => now, open: () => true });
  assert.deepEqual(sent.map(x => [x.instrument, x.why]), [["ABBV", "close under the 20-day average"]]);
  assert.equal(rh.placed.length, 1); assert.equal(rh.placed[0].type, "market");
  assert.deepEqual(await closeRules({ ledger: L, exec, now: () => now + 60000, open: () => true }), [], "once a day");
});

// A quote left from a failed read (here 2 hours old) must not decide the close rule.
test("close rules: an old quote is no signal", async () => {
  const { closeRules } = await import("../src/runner.mjs");
  const now = Date.parse("2026-11-03T20:52:00Z");
  const { L, rh } = setup({ rh: fakeRh({ abbv: 270 }) });
  L.meta("candles:robinhood:ABBV:long", JSON.stringify({ bars: Array.from({ length: 25 }, (_, i) => ({ t: Date.parse("2026-10-01T20:00:00Z") + i * 86400000, o: 285, h: 286, l: 284, c: 285 })) }));
  L.setQuote({ broker: "robinhood", instrument: "ABBV", price: 270, source: "t", asOf: now - 2 * 3600000 });
  L.lease(EXECUTION_LEASE, "live-test", 120000, now);
  const exec = { mode: "live", owner: "live-test", adapters: { robinhood: robinhoodAdapter(tradingRobinhood(rh, toolKind), { account_number: "ACCT" }) }, paused: async () => false };
  assert.deepEqual(await closeRules({ ledger: L, exec, now: () => now, open: () => true }), []);
  assert.equal(rh.placed.length, 0);
  // The position was not decided, so a fresh quote a minute later still gets the day's close rule.
  L.setQuote({ broker: "robinhood", instrument: "ABBV", price: 270, source: "t", asOf: now + 60000 });
  const sent = await closeRules({ ledger: L, exec, now: () => now + 60000, open: () => true });
  assert.deepEqual(sent.map(x => x.why), ["close under the 20-day average"]);
  assert.equal(rh.placed.length, 1);
  assert.deepEqual(await closeRules({ ledger: L, exec, now: () => now + 120000, open: () => true }), [], "then once a day");
});

test("market hours: 2028 holidays and early closes", async () => {
  const { marketOpen } = await import("../src/hours.mjs");
  assert.equal(marketOpen(Date.parse("2028-04-14T15:00:00Z")), false, "Good Friday 2028");
  assert.equal(marketOpen(Date.parse("2028-11-23T16:00:00Z")), false, "Thanksgiving 2028");
  assert.equal(marketOpen(Date.parse("2028-07-03T18:30:00Z")), false, "14:30 on the July 3 early close");
  assert.equal(marketOpen(Date.parse("2027-12-31T16:00:00Z")), true, "2028-01-01 is a Saturday: Dec 31 trades");
});

test("weekly review: a failed answer is tried again, 3 times at most and 30 minutes apart; done once it works", async () => {
  const { liveExtras } = await import("../src/live-sessions.mjs");
  const { mkdtemp } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "richie-review-")), L = openLedger();
  const sunday = Date.parse("2026-11-08T23:05:00Z");   // Sunday 18:05 Eastern
  let t = sunday, calls = 0, answer = "no sections";
  const real = globalThis.fetch;
  globalThis.fetch = async () => { calls++; return Response.json({ choices: [{ message: { content: answer } }], usage: { cost: 0.001 } }); };
  try {
    const x = liveExtras({ ledger: L, rh: { call: async () => "{}" }, parts: { ready: async () => {}, account: {} }, ks: null, exec: { mode: "observe", adapters: {} }, key: "k", log: () => {}, dataDir: dir, now: () => t });
    const job = x.jobs.find(j => j.name === "weekly review");
    await job.run(); assert.equal(calls, 1, "runs after 18:00 too, not only in the 18:00 minute");
    t += 60000; await job.run(); assert.equal(calls, 1, "waits 30 minutes before trying again");
    answer = "## Lessons\n- Keep the trend filter.\n## Proposed rule changes\nNone.";
    t = sunday + 31 * 60000; await job.run(); assert.equal(calls, 2);
    assert.equal(L.meta("last_review"), "2026-11-08");
    t += 31 * 60000; await job.run(); assert.equal(calls, 2, "done for the week");
    const L2 = openLedger(), y = liveExtras({ ledger: L2, rh: { call: async () => "{}" }, parts: { ready: async () => {}, account: {} }, ks: null, exec: { mode: "observe", adapters: {} }, key: "k", log: () => {}, dataDir: dir, now: () => t });
    answer = "no sections"; calls = 0;
    for (let i = 0; i < 5; i++) { await y.jobs.find(j => j.name === "weekly review").run(); t += 31 * 60000; }
    assert.equal(calls, 3, "a model outage costs 3 calls at most");
  } finally { globalThis.fetch = real; }
});

test("Telegram updates: only the owner's chat is answered, replies recorded, offset advanced; chat keeps its history", async () => {
  const { handleUpdates } = await import("../src/live.mjs");
  const { L } = setup(), sent = [];
  const updates = [{ update_id: 7, message: { chat: { id: 111 }, text: "status" } }, { update_id: 8, message: { chat: { id: 999 }, text: "pause" } }];
  const next = await handleUpdates(updates, { ledger: L, chatId: "111", send: async t => sent.push(t), ctx: { chat: async () => "x" } });
  assert.equal(next, 9); assert.equal(sent.length, 1); assert.match(sent[0], /^Robinhood|^Positions|Scoreboard/);
  assert.notEqual(L.meta("paused"), "1", "a stranger's pause is ignored");
  assert.deepEqual(L.events().map(e => e.kind).sort(), ["message", "reply"]);
  // Month to date in status.
  L.meta("month", JSON.stringify({ month: "2026-11", start: { at: T0, value: 20, spy: 680 }, now: { at: T0, value: 20.4, spy: 687 } }));
  assert.match(statusText(L), /This month: account \+2\.0%, SPY \+1\.0%/);
  // Chat history reaches the model on the next turn.
  const { chatTurn } = await import("../src/sessions.mjs");
  let seen = null;
  await chatTurn({ ledger: L, model: async m => { seen = m.slice(); return { role: "assistant", content: "ok" }; }, text: "and XLE?", nowText: "now", history: [{ q: "How is ABBV?", a: "Up 2%." }] });
  assert.deepEqual(seen.slice(1).map(m => m.content), ["How is ABBV?", "Up 2%.", "and XLE?"]);
});

test("Robinhood's fractional limit refusal is a rejection, not unknown; session sells of fractions go at market", async () => {
  const placed = [];
  const rh = { call: async (n, a) => { placed.push(a); throw Error('Robinhood: API error 400: {"non_field_errors":["Limit order quantity cannot include fractional shares."]}'); } };
  const adapter = robinhoodAdapter(rh, { account_number: "ACCT" });
  await assert.rejects(adapter.place({ instrument: "DVN", side: "sell", quantity: 0.039494, limitPrice: 48.85, clientId: "c1" }), e => e.rejected === true);
  const { handleProposal } = await import("../src/sessions.mjs");
  const { L } = setup();
  L.setAccount({ broker: "robinhood", cash: 0.02, value: 10.3, source: "t", asOf: Date.now() });
  const sent = [], ok = { place: async o => { sent.push(o); return { state: "submitted", cumQty: 0 }; } };
  const out = await handleProposal({ instrument: "ABBV", side: "sell", quantity: 0.014091, limitPrice: 287 }, { ledger: L, broker: "robinhood", review: async () => "", liveQuote: async () => ({ price: 287 }), mode: "live", owner: "live-test", adapter: ok, now: () => T0 });
  assert.match(out, /^Order submitted/, out);
  assert.equal(sent[0].orderType, "market");
});

test("every Robinhood path: a fractional stock quantity never goes out as a limit order", async () => {
  const placed = [];
  const adapter = robinhoodAdapter({ call: async (n, a) => { placed.push([n, a]); return J({ id: "x", state: "queued" }); } }, { account_number: "A", rhs_account_number: "R" });
  await adapter.place({ instrument: "DVN", side: "sell", quantity: 0.039494, limitPrice: 48.85, clientId: "a" });                       // a caller that forgot
  await adapter.place({ instrument: "XLE", side: "buy", quantity: 2, limitPrice: 67, clientId: "b" });                                  // whole shares may be limit
  await adapter.place({ instrument: "BTC", instrument_type: "crypto", side: "buy", quantity: 0.0001, limitPrice: 70000, clientId: "c" }); // crypto takes fractional limits
  assert.deepEqual(placed.map(([, a]) => a.type), ["market", "limit", "limit"]);
  assert.equal(placed[0][1].limit_price, undefined);
});

test("a closed real trade produces a lesson that the next session reads", async () => {
  const { liveExtras } = await import("../src/live-sessions.mjs");
  const { mkdtemp, readFile } = await import("node:fs/promises"), { tmpdir } = await import("node:os"), { join } = await import("node:path");
  const dir = await mkdtemp(join(tmpdir(), "richie-lessons-")), L = openLedger();
  L.addTrade({ broker: "robinhood", instrument: "DVN", entry: 50.64, exit: 48.8, ret: -0.0363, dollars: 2, why: "close under the 20-day average", openedAt: T0 - 19 * 86400000, closedAt: T0, paper: false, source: "live" });
  L.addTrade({ broker: "robinhood", instrument: "MU", entry: 100, exit: 92, ret: -0.08, why: "stop", closedAt: T0, paper: true });
  const real = globalThis.fetch;
  let asked = "";
  globalThis.fetch = async (url, opts) => { asked = JSON.parse(opts.body).messages[1].content; return Response.json({ choices: [{ message: { content: "Energy names that slip under the 20-day after a sector rally rarely recover in days; exit on the first close below." } }], usage: { cost: 0.0002 } }); };
  try {
    const x = liveExtras({ ledger: L, rh: { call: async () => "{}" }, parts: { ready: async () => {}, account: {} }, ks: null, exec: { mode: "observe", adapters: {} }, key: "k", log: () => {}, dataDir: dir, now: () => T0 });
    await x.jobs.find(j => j.name === "memory").run();
    await x.jobs.find(j => j.name === "memory").run();   // once per trade
  } finally { globalThis.fetch = real; }
  assert.match(asked, /^Trade: robinhood DVN, entry 50\.64, exit 48\.8, return -3\.6%, exit reason: close under the 20-day average, held 19 days/);
  const text = await readFile(join(dir, "lessons.md"), "utf8");
  assert.equal(text.trim().split("\n").length, 1, "one lesson, paper trades excluded");
  assert.match(text, /^- 2026-11-03 DVN \(close under the 20-day average, -3\.6%\): Energy names that slip/);
  assert.match(L.events().find(e => e.kind === "lesson").text, /^Lesson from DVN:/);
});
