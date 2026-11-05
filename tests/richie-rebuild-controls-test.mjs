// Dashboard controls (src/CONTROLS.md, approved 2026-11-02): the server only adds checked requests
// to the inbox; live Richie runs them through the same code as Telegram commands and stop exits.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { readFile } from "node:fs/promises";
import { openLedger, positionId } from "../src/ledger.mjs";
import { EXECUTION_LEASE } from "../src/execution.mjs";
import { handler } from "../src/server.mjs";
import { openInbox, parseRequest, runControls } from "../src/controls.mjs";

const T = 1_800_000_000_000, PUBLIC = "richie.example.com", EMAIL = "owner@example.com";
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

test("control requests: only the known kinds and fields, a fresh id, a real position", () => {
  assert.deepEqual(parseRequest({ id: id(1), kind: "pause" }), { request: { id: id(1), kind: "pause", args: {} } });
  assert.deepEqual(parseRequest({ id: id(2), kind: "sell", positionId: "kalshi:KXNYCSUBWAY-26OCT31-A4500000:no", quantity: 1.5 }).request.args,
    { positionId: "kalshi:KXNYCSUBWAY-26OCT31-A4500000:no", quantity: 1.5 });
  for (const [body, why] of [[null, /JSON object/], [{ id: id(3), kind: "pause", extra: 1 }, /field/], [{ id: "x", kind: "pause" }, /fresh id/],
    [{ id: id(4), kind: "buy" }, /Unknown/], [{ id: id(5), kind: "session", broker: "coinbase" }, /robinhood or kalshi/],
    [{ id: id(6), kind: "sell", positionId: "robinhood:ABBV" }, /position/], [{ id: id(7), kind: "sell", positionId: "robinhood:ABBV:long", quantity: 0 }, /above 0/]])
    assert.match(parseRequest(body).problem, why);
});

test("control endpoint: POST with the header, its own origin, JSON, the owner's Access email on the public host; nothing else", async () => {
  const inbox = openInbox(":memory:");
  const srv = createServer(handler({ source: async () => { throw Error("not used"); }, hosts: [PUBLIC, "127.0.0.1:8792"], accessHosts: [PUBLIC], controls: { inbox, email: EMAIL }, now: () => T })).listen(0, "127.0.0.1");
  await new Promise(r => srv.once("listening", r));
  const port = srv.address().port;
  const post = (headers, body) => new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/api/control", method: "POST", headers }, res => { let t = ""; res.on("data", c => t += c); res.on("end", () => resolve({ status: res.statusCode, body: t })); });
    req.on("error", reject); req.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  const pub = { Host: PUBLIC, "Cf-Access-Jwt-Assertion": "signed", "Cf-Access-Authenticated-User-Email": EMAIL, Origin: `https://${PUBLIC}`, "X-Richie-Control": "1", "Content-Type": "application/json" };
  const local = { Host: "127.0.0.1:8792", Origin: "http://127.0.0.1:8792", "X-Richie-Control": "1", "Content-Type": "application/json" };
  try {
    assert.equal((await post({ ...pub, "Cf-Access-Jwt-Assertion": "" }, { id: id(1), kind: "pause" })).status, 403);   // no Access
    assert.equal((await post({ ...pub, "X-Richie-Control": "" }, { id: id(1), kind: "pause" })).status, 403);            // another site's form
    assert.equal((await post({ ...pub, Origin: "https://evil.example.com" }, { id: id(1), kind: "pause" })).status, 403);
    assert.equal((await post({ ...pub, Origin: `http://${PUBLIC}` }, { id: id(1), kind: "pause" })).status, 403);
    assert.match((await post({ ...pub, "Cf-Access-Authenticated-User-Email": "someone@else.com" }, { id: id(1), kind: "pause" })).body, /not allowed for someone@else\.com/);
    assert.equal((await post({ ...pub, "Content-Type": "text/plain" }, { id: id(1), kind: "pause" })).status, 415);
    assert.equal((await post(pub, "x".repeat(3000))).status, 413);
    assert.equal((await post(pub, { id: id(1), kind: "buy" })).status, 400);
    assert.equal(inbox.recent().length, 0, "nothing refused reached the inbox");
    assert.equal((await post(pub, { id: id(1), kind: "pause" })).status, 202);
    assert.equal((await post(pub, { id: id(1), kind: "pause" })).status, 409);                                              // same id twice
    assert.equal((await post(local, { id: id(2), kind: "session", broker: "kalshi" })).status, 202);                        // the local address
    const rows = inbox.recent();
    assert.deepEqual(rows.map(r => [r.kind, r.email, r.via, r.status]).sort(), [["pause", EMAIL, PUBLIC, "pending"], ["session", null, "local", "pending"]]);
    for (let n = 3; n <= 10; n++) assert.equal((await post(local, { id: id(n), kind: "resume" })).status, 202);
    assert.equal((await post(local, { id: id(11), kind: "resume" })).status, 429);                                          // 10 a minute
  } finally { srv.close(); inbox.close(); }
});

function liveSetup() {
  const L = openLedger(":memory:"), inbox = openInbox(":memory:");
  let t = T; const now = () => t; now.add = ms => { t += ms; };
  for (const b of ["robinhood", "kalshi"]) L.setAccount({ broker: b, cash: 10, value: 10, source: "test", asOf: t });
  L.lease(EXECUTION_LEASE, "live", 3600000, t);
  // Real held position shape: XLE from the legacy import, 0.059483 shares.
  L.recordIntent({ clientId: "b1", broker: "robinhood", instrument: "XLE", instrumentType: "etf", side: "buy", quantity: 0.059483, limitPrice: 67.2, plan: { stop: 63.8, target: 74 } }, t);
  L.applyFill({ clientId: "b1", fillKey: "b1", qty: 0.059483, price: 67.2459, at: t });
  const placed = [];
  const adapter = { broker: "robinhood", place: async o => { placed.push(o); return { state: "filled", cumQty: o.quantity, avgPrice: 66.9 }; }, lookup: async () => null, positions: async () => [] };
  const exec = { mode: "live", owner: "live", adapters: { robinhood: adapter }, paused: async () => L.meta("paused") === "1" };
  const readers = { robinhood: { quotes: async ps => ps.map(p => ({ broker: "robinhood", instrument: p.instrument, price: 66.9, asOf: t })) } };
  const told = [], started = [];
  const run = () => runControls({ inbox, ledger: L, exec, readers, start: b => { started.push(b); return `Starting a ${b} session now.`; }, notify: async m => { told.push(m); }, now });
  return { L, inbox, now, placed, told, started, run };
}

test("live Richie runs each control once, through the usual code, and says so on Telegram", async () => {
  const { L, inbox, now, placed, told, started, run } = liveSetup();
  const add = (n, kind, args = {}) => inbox.add({ id: id(n), kind, args, via: "local", at: now() });
  add(1, "pause"); add(2, "session", { broker: "kalshi" });
  await run();
  assert.equal(L.meta("paused"), "1"); assert.deepEqual(started, ["kalshi"]);
  add(3, "resume"); await run(); assert.equal(L.meta("paused"), "0");
  // Sell part, then the rest: the same market order a stop exit sends, at the live price.
  // Held here as the core: the owner selling it from the dashboard turns code's core buying off.
  L.run("UPDATE positions SET plan = ? WHERE id = ?", JSON.stringify({ role: "core" }), positionId("robinhood", "XLE"));
  add(4, "sell", { positionId: positionId("robinhood", "XLE"), quantity: 0.02 });
  await run();
  assert.deepEqual([placed[0].side, placed[0].quantity, placed[0].orderType, placed[0].limitPrice], ["sell", 0.02, "market", 66.9]);
  assert.equal(L.meta("core"), "off");
  assert.equal(Number(L.position(positionId("robinhood", "XLE")).quantity.toFixed(6)), 0.039483);
  add(5, "sell", { positionId: positionId("robinhood", "XLE") });
  await run();
  assert.equal(Number(placed[1].quantity.toFixed(6)), 0.039483);   // the adapter sends it rounded (brokers test)
  assert.equal(L.position(positionId("robinhood", "XLE")).status, "closed");
  assert.equal(L.all("SELECT why FROM trades WHERE instrument = 'XLE'")[0].why, "sold from the dashboard");
  assert.ok(inbox.recent().every(r => r.status === "done"));
  assert.equal(told.length, 5); assert.match(told[3], /^Dashboard \(sell 0\.02 XLE\): Sell of 0\.02 XLE near \$66\.9: filled\. Core buying is off until you send core on\./);
  assert.ok(L.all("SELECT * FROM events WHERE kind = 'control'").length === 5);
  await run(); assert.equal(placed.length, 2, "a done request never runs again");
});

test("live Richie refuses stale, oversized, duplicate-sell and interrupted controls", async () => {
  const { L, inbox, now, placed, run } = liveSetup();
  const xle = positionId("robinhood", "XLE");
  inbox.add({ id: id(1), kind: "pause", args: {}, via: "local", at: now() - 61000 });
  inbox.add({ id: id(2), kind: "sell", args: { positionId: xle, quantity: 1 }, via: "local", at: now() });
  inbox.add({ id: id(3), kind: "sell", args: { positionId: "robinhood:DVN:long" }, via: "local", at: now() });
  await run();
  const by = Object.fromEntries(inbox.recent().map(r => [r.id, r]));
  assert.match(by[id(1)].result, /Expired/); assert.notEqual(L.meta("paused"), "1");
  assert.match(by[id(2)].result, /Only 0\.059483 held/);
  assert.match(by[id(3)].result, /not open/);
  assert.equal(placed.length, 0);
  // An unresolved earlier sell blocks a second one, as for stop exits.
  L.recordIntent({ clientId: "s0", broker: "robinhood", instrument: "XLE", instrumentType: "etf", side: "sell", quantity: 0.059483, limitPrice: 66 }, now());
  inbox.add({ id: id(4), kind: "sell", args: { positionId: xle }, via: "local", at: now() });
  await run();
  assert.match(inbox.recent().find(r => r.id === id(4)).result, /not reconciled/);
  // A request claimed when Richie restarted is never run again.
  inbox.add({ id: id(5), kind: "pause", args: {}, via: "local", at: now() }); inbox.claim(id(5));
  await run();
  assert.match(inbox.recent().find(r => r.id === id(5)).result, /Interrupted by a restart/); assert.notEqual(L.meta("paused"), "1");
});

test("the dashboard process never loads order code: controls.mjs reaches execution only inside live Richie", async () => {
  const src = await readFile(new URL("../src/controls.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src.split("\n").filter(l => /^\s*import\b/.test(l)).join("\n"), /execution|adapters|robinhood|kalshi\.mjs|child_process/);
  const sb = await readFile(new URL("../src/dashboard-sandbox.sb", import.meta.url), "utf8");
  assert.match(sb, /\(allow file-write\* \(subpath \(string-append \(param "DATA"\) "\/controls"\)\)\)/);
  assert.match(sb, /\(deny mach-lookup \(global-name "com\.apple\.SecurityServer"\)/);
  assert.match(sb, /\(deny network-outbound \(remote ip\)\)/);
});
