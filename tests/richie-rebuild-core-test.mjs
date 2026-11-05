// Richie rebuild (src/): journal results, health and retry, Telegram delivery, voice, prompts.
// Offline only: no broker, model, Telegram or Keychain call.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendJournal } from "../src/journal.mjs";
import { errorClass, backoff, withRetry, freshness } from "../src/health.mjs";
import { openLedger } from "../src/ledger.mjs";
import { telegramClient } from "../src/telegram.mjs";
import { VOICE, telegramText, fitsDefault, wordCount, orderMessage, notifyDecision } from "../src/voice.mjs";
import { sessionPrompt, chatPrompt } from "../src/prompts.mjs";
import { REVIEW } from "../src/live-sessions.mjs";

test("journal: a write that fails says so, and a good one is ok", async () => {
  const dir = await mkdtemp(join(tmpdir(), "richie-journal-"));
  await mkdir(join(dir, "dir.md"));   // writing to a directory fails on every OS, standing in for an unwritable file
  const write = await appendJournal(join(dir, "dir.md"), "Kalshi journal", "x");
  assert.equal(write.status, "unwritable");
  assert.equal((await appendJournal(join(dir, "ok.md"), "Kalshi journal", "- next")).status, "ok");
});

test("errors seen in richie.log are classified, and auth is never retried", async () => {
  assert.equal(errorClass(Error("fetch failed")), "network");
  assert.equal(errorClass(Error("The operation was aborted due to timeout")), "timeout");
  assert.equal(errorClass(Error("Robinhood MCP 403: client id not allowed: <missing>")), "auth");
  assert.equal(errorClass(Error("Robinhood MCP 401: client id not allowed: <missing>")), "auth");
  assert.equal(errorClass(Error("Unexpected token < in JSON at position 0")), "malformed");
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls++; throw Error("Robinhood MCP 403: client id not allowed: <missing>"); }, { sleep: async () => {} }), /client id/);
  assert.equal(calls, 1);
  calls = 0; const waits = [];
  await assert.rejects(withRetry(async () => { calls++; throw Error("fetch failed"); }, { attempts: 4, sleep: async ms => waits.push(ms), random: () => 1 }));
  assert.equal(calls, 4); assert.deepEqual(waits, [2000, 4000, 8000]);
  assert.equal(backoff(30, { random: () => 1 }), 300000);   // capped
  assert.equal(backoff(0, { random: () => 0 }), 2000);      // never a tight loop
});

test("freshness: live, stale, unavailable and sample, never inferred from a missing value", () => {
  const now = 1_000_000;
  assert.equal(freshness({ asOf: now - 1000 }, 60000, now), "live");
  assert.equal(freshness({ asOf: now - 120000 }, 60000, now), "stale");
  assert.equal(freshness({}, 60000, now), "unavailable");
  assert.equal(freshness({ asOf: now - 120000, lastErrorAt: now - 1000 }, 60000, now), "unavailable");
  assert.equal(freshness({ asOf: now, sample: true }, 60000, now), "sample");
});

test("Telegram: ok false is not delivered, a network blip is retried, and every message has a delivery record", async () => {
  const L = openLedger();
  const rejecting = telegramClient({ chatId: 1, ledger: L, sleep: async () => {}, call: async () => { throw Object.assign(Error("Telegram 400: chat not found"), { telegram: { ok: false } }); } });
  assert.deepEqual(await rejecting.send("Filled: bought 1 ABBV at $283.67, fees $0.00."), { delivered: false, id: 1, error: "unknown" });
  let n = 0;
  const flaky = telegramClient({ chatId: 1, ledger: L, sleep: async () => {}, call: async () => { if (++n < 3) throw Error("fetch failed"); return { message_id: 77 }; } });
  assert.equal((await flaky.send("Stop hit on XLE.")).delivered, true);
  const rows = L.notifications().sort((a, b) => a.id - b.id);
  assert.deepEqual(rows.map(r => [r.status, r.attempts]), [["failed", 1], ["delivered", 3]]);
  assert.equal(rows[1].detail, "message 77");
  const down = telegramClient({ chatId: 1, ledger: L, call: async () => { throw Error("fetch failed"); } });
  assert.deepEqual(await down.receive(5), { ok: false, updates: [], error: "network" });
  assert.equal(L.health().find(h => h.component === "telegram_receive").status, "degraded");
});

test("voice: standard capitalization, links and numbers untouched, no lowercase transform", () => {
  const raw = "Filled: bought 0.0141 ABBV at $283.67 \u2014 see https://Example.com/Case/ABC?Q=X";
  assert.equal(telegramText(raw), "Filled: bought 0.0141 ABBV at $283.67, see https://Example.com/Case/ABC?Q=X");
  assert.doesNotMatch(VOICE, /lowercase|gen z|ngl|tbh|45 words/i);
  assert.match(VOICE, /Standard capitalization/);
  assert.match(VOICE, /30 words/);
});

test("voice: each order state has a short exact message", () => {
  const base = { broker: "robinhood", instrument: "ABBV", side: "buy", requested_qty: 0.0141, limit_price: 283.7, filled_qty: 0, fees: 0 };
  const states = {
    submitted: { ...base, state: "submitted" },
    partially_filled: { ...base, state: "partially_filled", filled_qty: 0.01, avg_price: 283.67 },
    filled: { ...base, state: "filled", filled_qty: 0.0141, avg_price: 283.67, fees: 0 },
    rejected: { ...base, state: "rejected", reason: "validation: market closed" },
    cancelled: { ...base, state: "cancelled" },
    unknown: { ...base, state: "unknown" },
  };
  const kalshi = { broker: "kalshi", instrument: "KXRAINNYC-26OCT28-T0.10", outcome_side: "yes", side: "buy", requested_qty: 3, limit_price: 0.62, filled_qty: 2, avg_price: 0.62, fees: 0.04, state: "cancelled" };
  for (const [state, o] of Object.entries(states)) {
    const m = orderMessage(o);
    assert.ok(fitsDefault(m), `${state}: ${m} (${wordCount(m)} words)`);
    assert.match(m, /^[A-Z]/);
    assert.match(m, /ABBV/);
  }
  assert.match(orderMessage(states.filled), /0\.0141 ABBV at \$283\.67, fees \$0\.00/);
  assert.match(orderMessage(states.unknown), /won't resend/);
  assert.doesNotMatch(orderMessage(states.unknown), /filled|bought/i);
  assert.match(orderMessage(kalshi), /Cancelled after a partial fill: 2 KXRAINNYC-26OCT28-T0\.10 YES at 62¢/);
  assert.equal(orderMessage({ ...base, state: "intent" }), null);
});

test("notifications: trades and important alerts go out; routine scans, setups and recaps stay silent", () => {
  assert.equal(notifyDecision({ kind: "scan", trade: false }), "silent");
  assert.equal(notifyDecision({ kind: "setup_forming" }), "silent");
  assert.equal(notifyDecision({ kind: "recap", period: "weekly" }), "silent");
  assert.equal(notifyDecision({ kind: "quote" }), "silent");
  assert.equal(notifyDecision({ kind: "order", state: "filled" }), "send");
  assert.equal(notifyDecision({ kind: "order", state: "intent" }), "silent");
  assert.equal(notifyDecision({ kind: "alert", severity: "important" }), "send");
  assert.equal(notifyDecision({ kind: "alert", severity: "info" }), "silent");
  assert.equal(notifyDecision({ kind: "scan", requested: true }), "send");
});

test("prompts: every path carries the new voice and none restates retired caps, $10 or old style", () => {
  const texts = [sessionPrompt({ broker: "kalshi", now: "Oct 27, 12:00", strategy: { version: "x", text: "y" }, accounts: "Kalshi cash $3.62" }),
    chatPrompt({ now: "Oct 27", accounts: "a", positions: "p", health: "h" }), REVIEW];
  for (const t of texts.slice(0, 2)) assert.ok(t.includes(VOICE));
  for (const t of texts) {
    assert.doesNotMatch(t, /20% of the account|3 (positions|bets|buys)|a day|30% drop|\$10\b|lowercase|gen z|45 words|setup forming|hard limits line/i);
    assert.doesNotMatch(t, /[\u2013\u2014]/);
  }
  assert.match(texts[0], /cash only/);
  assert.match(texts[0], /no per-trade, position-count, daily-count or drawdown cap/);
  assert.match(texts[1], /outside what I handle/);
  assert.match(REVIEW, /Proposed rule changes/);   // the live weekly review proposes changes; it never applies them
});
