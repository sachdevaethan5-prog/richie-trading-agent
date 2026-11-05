// Richie rebuild: monitoring independent of research, protection truthfulness, delegated research bounds,
// strategy evaluation, and the read-only dashboard contract and server. Offline only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { openLedger, positionId } from "../src/ledger.mjs";
import { monitorTick, monitorTick as monitorTickAt, protectionState, scheduler, exitSignal } from "../src/monitor.mjs";
import { dispatch, fixtureProvider, packetProblems } from "../src/research.mjs";
import { evaluate, brier } from "../src/strategy.mjs";
import { snapshot, positionDetail, CONTRACT } from "../src/snapshot.mjs";
import { handler } from "../src/server.mjs";
import { demoLedger } from "../src/fixtures/demo.mjs";

const T = 1_800_000_000_000, M = 60000;
function held(L, { instrument = "XLE", type = "etf", plan = { stop: 61.8, target: 67.2 }, mode = "richie_watcher" } = {}) {
  L.run(`INSERT INTO positions (id, broker, instrument, instrument_type, quantity, cost_basis, plan, protection_mode, protection_interval_ms) VALUES (?, 'robinhood', ?, ?, 1, 63, ?, ?, ?)`,
    positionId("robinhood", instrument), instrument, type, JSON.stringify(plan), mode, M);
  return positionId("robinhood", instrument);
}

test("protection is stated plainly: watcher only while checks complete, broker only when verified", () => {
  const p = { protection_mode: "richie_watcher", plan: '{"stop":10}', protection_interval_ms: M, protection_last_ok_at: T - 30000 };
  assert.equal(protectionState(p, T).state, "watched");
  assert.match(protectionState(p, T).note, /not a broker order/);
  assert.equal(protectionState({ ...p, protection_last_ok_at: T - 3 * M }, T).state, "degraded");
  assert.equal(protectionState({ ...p, protection_last_ok_at: null }, T).state, "degraded");
  assert.equal(protectionState({ ...p, plan: "{}" }, T).state, "unprotected");
  assert.equal(protectionState({ protection_mode: "broker_native", protection_verified: 0 }, T).state, "degraded");
  assert.equal(protectionState({ protection_mode: "broker_native", protection_verified: 1 }, T).state, "broker");
  assert.equal(protectionState({ protection_mode: "none" }, T).state, "unprotected");
  // After hours a stock's watcher waits for the open (2026-11-02: ABBV and XLE read "degraded" every evening).
  const stock = { ...p, broker: "robinhood", instrument_type: "etf", protection_last_ok_at: T - 3 * M };
  assert.equal(protectionState(stock, T, { open: () => false }).state, "market closed");
  assert.equal(protectionState(stock, T, { open: () => true }).state, "degraded");
  assert.equal(protectionState({ ...stock, broker: "robinhood", instrument_type: "crypto" }, T, { open: () => false }).state, "degraded");   // crypto trades all day
});

test("monitor: fresh quote checks the exit, stale or failed quotes become alerts and degraded protection", async () => {
  const L = openLedger(), id = held(L);
  let now = T;
  const monitorTick = a => monitorTickAt({ ...a, marketIsOpen: () => true });   // the stock monitor runs in market hours only
  const r1 = await monitorTick({ ledger: L, now: () => now, quotes: async () => [{ broker: "robinhood", instrument: "XLE", price: 61.5, asOf: now - 5000, source: "test" }] });
  assert.deepEqual(r1.exits.map(e => [e.why, e.price]), [["stop", 61.5]]);
  assert.equal(protectionState(L.position(id), now).state, "watched");
  now += 10 * M;
  await monitorTick({ ledger: L, now: () => now, quotes: async () => [{ broker: "robinhood", instrument: "XLE", price: 63, asOf: now - 9 * M, source: "test" }] });
  assert.deepEqual(L.alerts().map(a => a.kind).sort(), ["protection", "stale_quote"]);
  await monitorTick({ ledger: L, now: () => now, quotes: async () => { throw Error("fetch failed"); } });
  assert.ok(L.alerts().some(a => a.kind === "monitor_failed" && /not being watched/.test(a.text)));
  assert.equal(L.health().find(h => h.component === "monitor").error_class, "network");
  now += M;
  await monitorTick({ ledger: L, now: () => now, quotes: async () => [{ broker: "robinhood", instrument: "XLE", price: 63, asOf: now, source: "test" }] });
  assert.equal(L.alerts().length, 0);   // recovered: every alert resolved
});

test("a stalled research job does not delay the monitor lane, and lanes replace the global lock", async () => {
  const L = openLedger();
  let now = T, monitorRuns = 0, researchStarted = 0;
  const s = scheduler({ ledger: L, now: () => now, jobs: [
    { name: "research", lane: "research", priority: 5, intervalMs: 30 * M, run: () => { researchStarted++; return new Promise(() => {}); } },   // never finishes
    { name: "monitor", lane: "monitor", priority: 0, intervalMs: M, run: async () => { monitorRuns++; } }] });
  const settle = () => new Promise(r => setImmediate(r));   // lets finished lanes release, never waits on a stalled one
  s.tick(); await settle();
  for (let i = 0; i < 5; i++) { now += M; s.tick(); await settle(); }
  assert.equal(researchStarted, 1); assert.ok(s.busy("research"));
  assert.equal(monitorRuns, 6);
  assert.equal(L.job("monitor").runs, 6);
});

test("after a restart an overdue job runs once, not once per missed interval", async () => {
  const L = openLedger();
  L.defineJob("monitor", 0, M);
  L.run("UPDATE jobs SET last_started_at = ? WHERE name = 'monitor'", T - 60 * M);
  let runs = 0;
  const s = scheduler({ ledger: L, now: () => T, jobs: [{ name: "monitor", lane: "monitor", priority: 0, intervalMs: M, run: async () => { runs++; } }] });
  await Promise.all(s.tick()); await Promise.all(s.tick());
  assert.equal(runs, 1); assert.equal(L.job("monitor").late, 1);
});

const item = (over = {}) => ({ source: "https://www.weather.gov/x", fact: "f", observedAt: T - M, unknowns: [], ...over });
const packet = (over = {}) => ({ recommendation: "supports", items: [item()], countercase: "c", assumptions: [], ...over });

test("research: off by default, read-only tools only, bounded by time, calls and workers", async () => {
  const off = await dispatch([{ id: "a", subject: "X", role: "r", question: "q", validityMs: M }]);
  assert.equal(off[0].status, "disabled");
  const tools = { web_search: async () => "ok" };
  const packets = { ok: { packet: packet() }, trade: { useTool: "place_equity_order", packet: packet() }, cancel: { useTool: "kalshi_case", packet: packet() },
    hang: { hang: true }, bad: { packet: packet({ items: [item({ observedAt: undefined, unknowns: undefined })] }) }, stale: { packet: packet({ items: [item({ observedAt: T - 10 * M })] }) } };
  const task = id => ({ id, subject: id, role: "r", question: "q", validityMs: 5 * M });
  const out = await dispatch(["ok", "trade", "cancel", "hang", "bad", "stale"].map(task), { provider: fixtureProvider(packets), tools, now: () => T, budget: { maxWorkers: 6, maxMs: 50, maxCallsPerWorker: 2 } });
  const by = Object.fromEntries(out.map(o => [o.id, o]));
  assert.equal(by.ok.status, "complete");
  assert.match(by.trade.problems[0], /cannot call place_equity_order/);
  assert.match(by.cancel.problems[0], /cannot call kalshi_case/);
  assert.match(by.hang.problems[0], /timed out/);
  assert.ok(by.bad.problems.some(p => /observed time/.test(p)) && by.bad.problems.some(p => /unknowns/.test(p)));
  assert.deepEqual(by.stale.problems, ["stale evidence"]);
  const capped = await dispatch(["ok", "ok2", "ok3"].map(task), { provider: fixtureProvider({ ok: packets.ok, ok2: packets.ok, ok3: packets.ok }), now: () => T, budget: { maxWorkers: 2, maxMs: 50, maxCallsPerWorker: 2 } });
  assert.equal(capped[2].status, "skipped");
  let calls = 0;
  const greedy = async (t, tl) => { for (let i = 0; i < 5; i++) { calls++; await tl.web_search({}); } return packet(); };
  const spent = await dispatch([task("g")], { provider: greedy, tools, now: () => T, budget: { maxWorkers: 1, maxMs: 50, maxCallsPerWorker: 2 } });
  assert.match(spent[0].problems[0], /budget spent/); assert.equal(calls, 3);
});

test("research: valid evidence is cached within its window and refreshed after; disagreement is flagged", async () => {
  let now = T, asked = 0;
  const provider = async () => { asked++; return packet({ items: [item({ observedAt: now })] }); };
  const cache = new Map(), t = [{ id: "c", subject: "S", role: "r", question: "q", validityMs: 5 * M }];
  await dispatch(t, { provider, cache, now: () => now });
  now += M; const second = await dispatch(t, { provider, cache, now: () => now });
  assert.equal(asked, 1); assert.equal(second[0].cached, true);
  now += 10 * M; await dispatch(t, { provider, cache, now: () => now });
  assert.equal(asked, 2);
  const split = await dispatch([{ ...t[0], id: "a", role: "bull" }, { ...t[0], id: "b", role: "bear" }], { provider: fixtureProvider({ a: { packet: packet() }, b: { packet: packet({ recommendation: "opposes" }) } }), now: () => T });
  assert.equal(split.disagreement, true);
  assert.deepEqual(packetProblems({ recommendation: "maybe", items: [] }), ["recommendation must be supports, opposes or insufficient evidence", "no evidence items", "no countercase", "no assumptions listed"]);
});

test("evaluation cannot see the future, and costs lower the result", () => {
  const bars = Array.from({ length: 60 }, (_, i) => ({ t: i, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 1 }));
  let peeked = false;
  evaluate(bars, (seen, i) => { if (seen[i + 1] !== undefined) peeked = true; return null; });
  assert.equal(peeked, false);
  const signal = (seen, i) => i % 10 === 0 ? { stop: seen[i].c * 0.9, target: seen[i].c * 1.03, maxBars: 5 } : null;
  const free = evaluate(bars, signal), costly = evaluate(bars, signal, { costs: { slippage: 0.002, spread: 0.002 } });
  assert.ok(free.count > 0); assert.ok(costly.netReturn < free.netReturn);
  assert.match(free.sampleNote, /too few/);
  assert.equal(brier([{ fair: 0.7, outcome: 1 }, { fair: 0.7, outcome: 0 }]), (0.09 + 0.49) / 2);
});

test("snapshot contract: every account and quote carries source, time and freshness; unreadable is null, not zero", async () => {
  const L = openLedger();
  L.setAccount({ broker: "robinhood", cash: 4.8, value: 10.21, source: "Robinhood get_portfolio", asOf: T - M });
  L.accountError("kalshi", "network", T - 1000);
  const s = snapshot(L, { now: T, mode: "observe" });
  assert.equal(s.contract, CONTRACT);
  const [kalshi, rh] = s.accounts;
  assert.deepEqual([kalshi.broker, kalshi.freshness, kalshi.cash, kalshi.value, kalshi.lastErrorClass], ["kalshi", "unavailable", null, null, "network"]);
  assert.deepEqual([rh.freshness, rh.cash, rh.source, rh.asOf], ["live", 4.8, "Robinhood get_portfolio", T - M]);
  held(L);
  const p = snapshot(L, { now: T }).positions[0];
  assert.deepEqual([p.quote.freshness, p.marketValue, p.unrealizedPnl], ["unavailable", null, null]);
  const d = positionDetail(L, p.id, { now: T });
  assert.equal(d.forecast, null); assert.equal(d.candles, null);
});

test("server: loopback, GET only without controls, error is 503 with no figures, fixture is labeled sample", async () => {
  const demo = await demoLedger(T);
  const s1 = snapshot(demo.ledger, { now: T, strategy: demo.strategy });
  assert.equal(s1.sample, true);
  assert.ok(s1.positions.every(p => ["sample", "stale", "unavailable"].includes(p.quote.freshness)));
  assert.ok(s1.accounts.every(a => a.freshness === "sample"));
  const states = new Set(s1.positions.map(p => p.protection.state));
  assert.ok(states.has("watched") && states.has("degraded"));
  assert.ok(s1.orders.some(o => o.state === "unknown") && s1.orders.some(o => o.state === "partially_filled") && s1.orders.some(o => o.state === "rejected"));
  const serve = async (source, path, method = "GET") => {
    const srv = createServer(handler({ source })).listen(0, "127.0.0.1");
    await new Promise(r => srv.once("listening", r));
    try { const r = await fetch(`http://127.0.0.1:${srv.address().port}${path}`, { method }); return { status: r.status, body: await r.text(), csp: r.headers.get("content-security-policy") }; }
    finally { srv.close(); }
  };
  const ok = async () => ({ ...demo, now: T });
  assert.equal((await serve(ok, "/api/snapshot")).status, 200);
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await serve(ok, "/api/snapshot", m)).status, 405);
  assert.equal((await serve(ok, "/api/orders")).status, 404);
  const detail = JSON.parse((await serve(ok, `/api/positions/${encodeURIComponent(positionId("robinhood", "ABBV"))}`)).body);
  assert.equal(detail.position.instrument, "ABBV"); assert.ok(detail.position.candles.bars.length); assert.equal(detail.position.forecast, null);
  const broken = await serve(async () => { throw Object.assign(Error("no ledger"), { code: "SQLITE_CANTOPEN" }); }, "/api/snapshot");
  assert.equal(broken.status, 503); assert.doesNotMatch(broken.body, /cash|value|\d+\.\d+/);
  const page = await serve(ok, "/");
  assert.match(page.csp, /connect-src 'self'/);
  // The page never has a form; its only POST goes to /api/control (CONTROLS.md), which this server, started without
  // an inbox, does not even have (the POSTs above got 405).
  assert.doesNotMatch(page.body, /<form|method="post"/i);
  assert.deepEqual([...page.body.matchAll(/fetch\('([^']+)',\{method:/g)].map(m => m[1]), ["/api/control"]);
  assert.match(page.body, /Fixture data\. Every figure/);
  assert.match(page.body, /No current forecast/);
});

test("server behind Cloudflare: only known hosts, the public one only with Access's header, short addresses", async () => {
  const demo = await demoLedger(T);
  const srv = createServer(handler({ source: async () => ({ ...demo, now: T }), hosts: ["richie.example.com"], accessHosts: ["richie.example.com"] })).listen(0, "127.0.0.1");
  await new Promise(r => srv.once("listening", r));
  const port = srv.address().port;
  // fetch() will not set Host, so this uses node:http directly.
  const { request } = await import("node:http");
  const get = (path, headers = {}) => new Promise((resolve, reject) => request({ host: "127.0.0.1", port, path, headers }, res => { res.resume(); resolve(res.statusCode); }).on("error", reject).end());
  try {
    assert.equal(await get("/api/snapshot", { Host: "evil.example.com" }), 421);
    assert.equal(await get("/api/snapshot", { Host: "richie.example.com" }), 403);
    assert.equal(await get("/api/snapshot", { Host: "richie.example.com", "Cf-Access-Jwt-Assertion": "signed.by.cloudflare" }), 200);
    assert.equal(await get(`/api/positions/${"a".repeat(400)}`, { Host: "richie.example.com", "Cf-Access-Jwt-Assertion": "x" }), 414);
  } finally { srv.close(); }
});

test("server source never touches secrets, the legacy state or broker modules", async () => {
  const src = await readFile(new URL("../src/server.mjs", import.meta.url), "utf8") + await readFile(new URL("../src/snapshot.mjs", import.meta.url), "utf8");
  const imports = src.split("\n").filter(l => /^\s*import\b|import\(/.test(l)).join("\n");
  assert.doesNotMatch(imports, /child_process|robinhood|kalshi|adapters|journal|state\.mjs|\.\.\/\.\.\//);
  assert.doesNotMatch(src.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n"), /security|Keychain|state\.json|journal\.md/);
  assert.match(src, /"127\.0\.0\.1"/);
});

test("strategy: a trailing exit rule closes at that bar's close and never sees later bars", async () => {
  const { evaluate } = await import("../src/strategy.mjs");
  const bars = [100, 101, 103, 106, 110, 108, 104, 120].map((c, t) => ({ t, o: c, h: c + 0.5, l: c - 0.5, c, v: 1 }));
  let longest = 0;
  const r = evaluate(bars, (seen, i) => i === 0 ? { stop: 50, target: 1000, exit: (upTo, j) => { longest = Math.max(longest, upTo.length); return upTo[j].c < upTo[j - 1].c; } } : null);
  assert.equal(r.count, 1);
  assert.equal(r.trades[0].why, "rule");
  assert.equal(r.trades[0].exit, 108);              // the first lower close
  assert.equal(longest, 6, "the rule saw bars up to the exit bar only");
});

// The live Kalshi position of 2026-11-02 (its ledger row): a session case with no stop or target. It was sold "on target"
// two minutes after filling because null read as 0. A missing level must never fire, and leaves the position unprotected.
test("a plan with null stop and target never signals an exit, and a Kalshi bet like that is held to settlement", () => {
  const p = { id: "kalshi:KXNYCSUBWAY-26OCT31-A4500000:no", broker: "kalshi", instrument: "KXNYCSUBWAY-26OCT31-A4500000", instrument_type: "event_contract", side: "no",
    plan: '{"stop":null,"target":null,"entry":0.93,"source":"session case"}', protection_mode: "richie_watcher", protection_interval_ms: 120000, protection_last_ok_at: T };
  for (const bid of [0, 0.5, 0.91, 0.99]) assert.equal(exitSignal(p, { bid }), null);
  assert.equal(protectionState(p, T).state, "settlement");   // held to settlement by design, not an alarm
  assert.equal(protectionState({ ...p, plan: '{"stop":null,"target":0.98}' }, T).state, "unprotected");   // a target but no stop still is
  const set = { ...p, plan: '{"stop":0.8,"target":0.98}' };
  assert.deepEqual(exitSignal(set, { bid: 0.98 }), { why: "target", price: 0.98 });
  assert.deepEqual(exitSignal(set, { bid: 0.8 }), { why: "stop", price: 0.8 });
});
