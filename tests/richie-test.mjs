// Richie's shared rules: which Robinhood tools he may use, the research case, broker answers, Kalshi bodies and signing.
import assert from "node:assert/strict";
import { toolKind, caseProblem, portfolioOf, agenticAccount } from "../src/core/lib.mjs";
import { parseRpc } from "../src/core/robinhood.mjs";

for (const [name, kind] of [["place_option_order", "blocked"], ["exercise_option", "blocked"], ["get_limited_margin_upgrade_info", "blocked"], ["create_watchlist", "blocked"],
  ["decline_trade_approval", "blocked"], ["delete_alert", "blocked"], ["some_new_tool", "blocked"], ["get_portfolio", "read"],
  ["review_equity_order", "preview"], ["preview_crypto_order", "preview"], ["place_equity_order", "order"], ["place_crypto_order", "order"], ["place_advanced_order", "order"],
  ["cancel_equity_order", "cancel"]]) assert.equal(toolKind(name), kind, name);

const good = { symbol: "NVDA", kind: "stock", thesis: "breakout on volume", entry: 100, stop: 93, target: 115, invalidation: "close under 20-day", sources: ["quote", "news"] };
assert.equal(caseProblem(good), null);
assert.match(caseProblem({ ...good, stop: 101 }), /stop must be below/);
assert.match(caseProblem({ ...good, stop: 80 }), /more than 15%/);
assert.match(caseProblem({ ...good, sources: ["one"] }), /2 sources/);
assert.match(caseProblem({ ...good, kind: "crypto", sources: ["a", "b", "c"] }), /catalyst/);
assert.equal(caseProblem({ ...good, kind: "crypto", catalyst: "ETF inflows", trend_30d: "up 12%", sources: ["a", "b", "c"] }), null);

assert.deepEqual(portfolioOf('{"data":{"total_value":"10","cash":"10","buying_power":{"buying_power":"20"}}}'), { value: 10, cash: 10 });
assert.ok(Number.isNaN(portfolioOf("oops").value));
assert.equal(agenticAccount('{"data":{"accounts":[{"account_number":"1","agentic_allowed":false},{"account_number":"2","agentic_allowed":true}]}}').account_number, "2");
assert.equal(agenticAccount('{"data":{"accounts":[]}}'), null);

assert.deepEqual(parseRpc("text/event-stream", 'event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"ok":1}}\n\n', 2), { jsonrpc: "2.0", id: 2, result: { ok: 1 } });
assert.deepEqual(parseRpc("application/json", '{"id":1,"result":{}}', 1), { id: 1, result: {} });
console.log("richie ok");
{
  const { rowsOf, symbolOfRow, priceOfRow, exitFor } = await import("../src/core/lib.mjs");
  const pos = rowsOf('{"data":{"positions":[{"symbol":"VSTM","quantity":"0.462","average_buy_price":"8.65"}],"next":null}}');
  assert.equal(symbolOfRow(pos[0]), "VSTM");
  assert.equal(symbolOfRow({ asset_code: "BTC-USD" }), "BTC");
  assert.equal(priceOfRow(rowsOf('{"data":{"quotes":[{"symbol":"VSTM","last_trade_price":"7.75"}]}}')[0]), 7.75);
  assert.equal(priceOfRow({ mark_price: "60000.5" }), 60000.5);
  assert.deepEqual(rowsOf("not json"), []);
  // Robinhood's real shapes (2026-10-14): equity quotes nested under quote, crypto symbols as BTCUSD.
  const eq = rowsOf('{"data":{"results":[{"quote":{"symbol":"SPY","last_trade_price":"769.63"},"close":{"symbol":"SPY","price":"769.6"}}]}}');
  assert.equal(symbolOfRow(eq[0]), "SPY");
  assert.equal(priceOfRow(eq[0]), 769.63);
  const cq = rowsOf('{"data":{"results":[{"symbol":"BTCUSD","mark_price":"81533.905","bid_price":"81533.9"}]}}');
  assert.equal(symbolOfRow(cq[0]), "BTC");
  assert.equal(priceOfRow(cq[0]), 81533.905);
  const held = { stop: 7.8, target: 10.4 };
  assert.equal(exitFor(held, 7.75), "stop");
  assert.equal(exitFor(held, 10.5), "target");
  assert.equal(exitFor(held, 9), null);
  assert.equal(exitFor(null, 9), null);
  console.log("stop watcher ok");
}
{
  const { scoreboard, paperExit, LIMITS } = await import("../src/core/lib.mjs");
  assert.equal(scoreboard([]).line, "no closed trades yet");
  const trades = [{ sym: "AAA", dollars: 4, ret: 112 / 100 - 1 }, { sym: "BBB", dollars: 3, ret: 47 / 50 - 1 }, { sym: "CCC", ret: NaN }];
  const sb = scoreboard(trades);
  assert.equal(sb.count, 2);
  assert.equal(sb.winRate, 0.5);
  assert.ok(Math.abs(sb.avgWin - 0.12) < 1e-9 && Math.abs(sb.avgLoss + 0.06) < 1e-9);
  assert.ok(Math.abs(sb.dollars - (4 * 0.12 - 3 * 0.06)) < 1e-9);
  assert.match(sb.line, /2 closed, 1 won \(50%\), average win \+12\.0%, average loss -6\.0%, about \$0\.30 made/);
  const p = { entry: 10, stop: 9, target: 12, at: 0 };
  assert.equal(paperExit(p, 8.9, 1000), "stop");
  assert.equal(paperExit(p, 12.5, 1000), "target");
  assert.equal(paperExit(p, 10.5, 1000), null);
  assert.equal(paperExit(p, 10.5, LIMITS.paperDays * 86400000), "time");
  assert.equal(paperExit(p, NaN, LIMITS.paperDays * 86400000), null);
  console.log("scoreboard ok");
}


// Kalshi (2026-10-20): the bet case, the YES-side order body and signing.
{
  const { kalshiFee, kalshiCaseProblem, kalshiOrderBody } = await import("../src/core/lib.mjs");
  const { signature } = await import("../src/core/kalshi.mjs");
  const { generateKeyPairSync, verify, constants } = await import("node:crypto");
  assert.equal(kalshiFee(1, 0.5), 0.02);   // 7% x 0.25 = 1.75 cents, rounded up
  assert.equal(kalshiFee(10, 0.5), 0.18);
  const bet = { ticker: "KXHIGHNY-26OCT21-T60", side: "yes", price: 0.4, fair: 0.55, thesis: "NWS says 63", resolves: "NWS high, Oct 21", invalidation: "forecast drops", sources: ["rules", "NWS", "history"] };
  assert.equal(kalshiCaseProblem(bet), null);
  assert.match(kalshiCaseProblem({ ...bet, fair: 0.46 }), /edge after the fee/);
  assert.match(kalshiCaseProblem({ ...bet, side: "maybe" }), /yes or no/);
  assert.match(kalshiCaseProblem({ ...bet, price: 1 }), /0\.01 to 0\.99/);
  assert.match(kalshiCaseProblem({ ...bet, sources: ["a", "b"] }), /3 sources/);
  assert.match(kalshiCaseProblem({ ...bet, stop: 0.5, target: 0.7 }), /stop must be below/);
  assert.equal(kalshiCaseProblem({ ...bet, stop: 0.25, target: 0.7 }), null);

  // Everything is quoted from YES: buy yes = bid, buy no = ask at 1 - price, sells are reduce_only.
  const body = (x) => { const b = kalshiOrderBody(x, "id"); return [b.side, b.price, b.reduce_only, b.time_in_force]; };
  assert.deepEqual(body({ ticker: "T", side: "yes", count: 3, price: 0.4 }), ["bid", "0.40", false, "immediate_or_cancel"]);
  assert.deepEqual(body({ ticker: "T", side: "no", count: 3, price: 0.3 }), ["ask", "0.70", false, "immediate_or_cancel"]);
  assert.deepEqual(body({ ticker: "T", side: "yes", count: 3, price: 0.5, sell: true }), ["ask", "0.50", true, "immediate_or_cancel"]);
  assert.deepEqual(body({ ticker: "T", side: "no", count: 3, price: 0.2, sell: true }), ["bid", "0.80", true, "immediate_or_cancel"]);
  assert.equal(kalshiOrderBody({ ticker: "T", side: "yes", count: 2.567, price: 0.4 }, "id").count, "2.56");

  // Signing: timestamp + method + path without the query, RSA-PSS SHA-256 or Ed25519.
  const signed = "1700000000000GET/trade-api/v2/portfolio/balance";
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const s1 = signature(rsa.privateKey.export({ type: "pkcs8", format: "pem" }), "1700000000000", "GET", "/trade-api/v2/portfolio/balance?x=1");
  assert.ok(verify("sha256", Buffer.from(signed), { key: rsa.publicKey, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST }, Buffer.from(s1, "base64")));
  const ed = generateKeyPairSync("ed25519");
  const s2 = signature(ed.privateKey.export({ type: "pkcs8", format: "pem" }), "1700000000000", "GET", "/trade-api/v2/portfolio/balance");
  assert.ok(verify(null, Buffer.from(signed), ed.publicKey, Buffer.from(s2, "base64")));
  console.log("kalshi ok");
}

// Grounding: a case's price must match the live market.
{
  const { entryOffProblem, kalshiPriceOffProblem } = await import("../src/core/lib.mjs");
  assert.equal(entryOffProblem(101, 100, "stock"), null);
  assert.match(entryOffProblem(105, 100, "stock"), /5\.0% from the live price/);
  assert.equal(entryOffProblem(102.5, 100, "crypto"), null);
  assert.match(entryOffProblem(100, NaN, "stock"), /could not read a live price/);
  assert.equal(kalshiPriceOffProblem(0.42, 0.44), null);
  assert.match(kalshiPriceOffProblem(0.30, 0.44), /not the live ask/);
  assert.match(kalshiPriceOffProblem(0.30, NaN), /could not read/);
}
