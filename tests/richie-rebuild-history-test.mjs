// evaluatePortfolio's exit options (2026-11-05: trailing stop, exit average, letting a winner run), on real XLK and SPY
// daily bars from late 2019 to mid 2020 (the February crash). Offline: the fixture is a saved slice of Yahoo's data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluatePortfolio } from "../src/strategy.mjs";

const fx = JSON.parse(readFileSync(new URL("./fixtures/richie-history-xlk-spy-2020.json", import.meta.url)));
const series = { SPY: fx.SPY, XLK: fx.XLK };
const T0 = Date.parse("2020-02-03");   // the signal day; the buy is the next open, 2020-02-04
const once = (b, i) => b[i].t === T0 ? {} : null;
const entryAt = fx.XLK.findIndex(b => b.t > T0), entryOpen = fx.XLK[entryAt].o;

test("defaults are the playbook exits, unchanged by the new options", () => {
  const a = evaluatePortfolio(series, { signal: once, useCore: false });
  const b = evaluatePortfolio(series, { signal: once, useCore: false, stop: 0.07, target: 0.14, maxBars: 20, trail: null, exitSma: 20 });
  assert.equal(a.count, 1);
  assert.deepEqual(a.trades, b.trades);
  assert.equal(a.netReturn, b.netReturn);
  assert.ok(a.trades[0].to < Date.parse("2020-03-15"), "the playbook is out before the March low");
});

test("a winner can run: no target, no time limit and no average exit hold to the end of the data", () => {
  const r = evaluatePortfolio(series, { signal: once, useCore: false, stop: 0.5, target: Infinity, maxBars: Infinity, exitSma: 0 });
  assert.equal(r.count, 0, "still open at the end, so not scored as a trade");
  assert.ok(Math.abs(r.netReturn - (1 / 3) * (fx.XLK.at(-1).c / entryOpen - 1)) < 1e-9, "a third of equity marked to the last close");
});

test("a trailing stop exits on the first low at or under the highest close since entry, less the trail", () => {
  const trail = 0.1, r = evaluatePortfolio(series, { signal: once, useCore: false, stop: trail, trail, target: Infinity, maxBars: Infinity, exitSma: 0 });
  let high = entryOpen, want = null;
  for (let i = entryAt; i < fx.XLK.length; i++) {
    const b = fx.XLK[i], floor = Math.max(entryOpen * (1 - trail), high * (1 - trail));
    if (b.l <= floor) { want = { t: b.t, price: Math.min(floor, b.o) }; break; }
    high = Math.max(high, b.c);
  }
  assert.equal(r.count, 1);
  assert.equal(r.trades[0].to, want.t);
  assert.ok(Math.abs(r.trades[0].ret - (want.price / entryOpen - 1)) < 1e-12);
});

test("the equity curve has one point per scored day and ends at the reported return", () => {
  const r = evaluatePortfolio(series, { signal: once });
  assert.equal(r.curve.length, fx.SPY.length - 51);
  assert.ok(Math.abs(r.curve.at(-1).e - 1 - r.netReturn) < 1e-12);
});
