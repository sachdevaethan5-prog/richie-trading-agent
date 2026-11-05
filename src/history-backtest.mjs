// Long-history test of Richie's stock rules. Free, no model, no broker, no account.
// Daily bars from Yahoo's public chart endpoint (dividend-adjusted), cached in <RICHIE_HOME>/history
// (~/.richie/history by default). Every run goes through strategy.mjs evaluatePortfolio, the same
// engine as the dashboard's Strategy view, with live slippage and spread. Universes picked without hindsight are the
// test; RICHIE19 (today's backtest list) is shown beside them to measure what hindsight adds.
// npm run backtest -- [--refresh] [--out report.md]   (or node src/history-backtest.mjs ...)
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { evaluatePortfolio } from "./strategy.mjs";
import { momentumSignal, BACKTEST_SYMBOLS } from "./live-sessions.mjs";
import { DATA_DIR } from "./env.mjs";

const DIR = join(DATA_DIR, "history");
const COSTS = { slippage: 0.0005, spread: 0.001 };   // what strategySummary charges
const YEAR = 365.25 * 86400000, D = s => Date.parse(s);

// Universes. SECTORS: the nine Select Sector SPDRs that exist since Dec 1998. BIG2004 and BIG2014: about the 20 largest
// US companies by market value at the end of 2004 and 2014 (losers like C, AIG, GE, INTC included), tested only after.
export const UNIVERSES = {
  SECTORS: { names: ["XLB", "XLE", "XLF", "XLI", "XLK", "XLP", "XLU", "XLV", "XLY"], from: "1999-01-01", split: "2013-01-01", hindsight: false },
  BIG2004: { names: ["GE", "XOM", "MSFT", "C", "WMT", "PFE", "BAC", "JNJ", "AIG", "IBM", "INTC", "PG", "MO", "JPM", "CSCO", "VZ", "WFC", "KO", "HD", "BRK-B"], from: "2005-01-01", split: "2016-01-01", hindsight: false },
  BIG2014: { names: ["AAPL", "XOM", "MSFT", "BRK-B", "GOOGL", "JNJ", "WFC", "WMT", "GE", "PG", "JPM", "CVX", "VZ", "META", "PFE", "KO", "ORCL", "T", "BAC", "INTC"], from: "2015-01-01", split: "2021-01-01", hindsight: false },
  RICHIE19: { names: BACKTEST_SYMBOLS.filter(s => s !== "SPY"), from: "1999-01-01", split: "2013-01-01", hindsight: true },
};

// Entries. Each sees only bars up to i (evaluatePortfolio slices). momentum is the live rule, imported, not copied.
const avg = (b, i, n, f = x => x.c) => { if (i < n - 1) return NaN; let t = 0; for (let j = i - n + 1; j <= i; j++) t += f(b[j]); return t / n; };
const closeHigh = (b, i, n) => { let m = -Infinity; for (let j = Math.max(0, i - n); j < i; j++) m = Math.max(m, b[j].c); return m; };
export const ENTRIES = {
  momentum: momentumSignal,
  "momentum, no volume": (b, i) => i >= 50 && b[i].c > avg(b, i, 20) && avg(b, i, 20) > avg(b, i, 50) && b[i].c >= closeHigh(b, i, 20) ? {} : null,
  "50-day high, above 200-day": (b, i) => i >= 200 && b[i].c >= closeHigh(b, i, 50) && b[i].c > avg(b, i, 50) && avg(b, i, 50) > avg(b, i, 200) ? {} : null,
  "52-week high": (b, i) => i >= 252 && b[i].c >= closeHigh(b, i, 252) && b[i].c > avg(b, i, 200) ? {} : null,
};
// Exits (evaluatePortfolio options). "playbook" is what Richie trades today.
export const EXITS = {
  "playbook (7% stop, 14% target, 20 days, 20-day avg)": { stop: 0.07, target: 0.14, maxBars: 20, exitSma: 20 },
  "7% stop, ride above 20-day avg": { stop: 0.07, target: Infinity, maxBars: Infinity, exitSma: 20 },
  "7% stop, ride above 50-day avg": { stop: 0.07, target: Infinity, maxBars: Infinity, exitSma: 50 },
  "10% trailing stop": { stop: 0.10, trail: 0.10, target: Infinity, maxBars: Infinity, exitSma: 0 },
  "20% trailing stop": { stop: 0.20, trail: 0.20, target: Infinity, maxBars: Infinity, exitSma: 0 },
  "10% stop, 30% target, 60 days, 50-day avg": { stop: 0.10, target: 0.30, maxBars: 60, exitSma: 50 },
};

export async function fetchBars(symbol, refresh) {
  const file = join(DIR, `${symbol}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=915148800&period2=${Math.floor(Date.now() / 1000)}&interval=1d`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`${symbol}: Yahoo answered ${res.status}`);
  const r = (await res.json())?.chart?.result?.[0], q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error(`${symbol}: Yahoo returned no daily bars`);
  const adj = r.indicators.adjclose?.[0]?.adjclose, bars = [];
  // Today's bar is still moving until the close: keep only finished days (New York time, after 5 pm counts as finished).
  const ny = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map(p => [p.type, p.value]));
  const lastDay = Date.parse(`${ny.year}-${ny.month}-${ny.day}`) - (Number(ny.hour) >= 17 ? 0 : 86400000);
  r.timestamp.forEach((t, i) => {
    const day = Math.floor(t / 86400) * 86400000;
    if (day > lastDay || q.close[i] == null || q.open[i] == null || !q.volume[i]) return;
    const f = adj?.[i] ? adj[i] / q.close[i] : 1;   // dividend and split adjusted, so SPY's benchmark includes dividends
    bars.push({ t: day, o: q.open[i] * f, h: q.high[i] * f, l: q.low[i] * f, c: q.close[i] * f, v: q.volume[i] });
  });
  writeFileSync(file, JSON.stringify(bars));
  return bars;
}

// One run with annualized figures. Sharpe from daily equity (idle cash earns nothing here; Richie's cash does not either).
export function stats(series, opts) {
  const r = evaluatePortfolio(series, { costs: COSTS, ...opts });
  const yrs = (r.curve.at(-1).t - r.curve[0].t) / YEAR, rets = r.trades.map(t => t.ret);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1));
  const daily = r.curve.slice(1).map((x, i) => x.e / r.curve[i].e - 1), dm = daily.reduce((a, b) => a + b, 0) / daily.length;
  const dsd = Math.sqrt(daily.reduce((a, b) => a + (b - dm) ** 2, 0) / daily.length);
  return { trades: r.count, perYear: r.count / yrs, cagr: (1 + r.netReturn) ** (1 / yrs) - 1, spyCagr: (1 + r.benchmark) ** (1 / yrs) - 1,
    dd: r.maxDrawdown, win: r.winRate, mean, t: rets.length > 1 ? mean / sd * Math.sqrt(rets.length) : 0, sharpe: dsd ? dm / dsd * Math.sqrt(252) : 0 };
}

function spyStats(spy) {   // buy and hold over the same days the strategy is scored (from bar 51)
  const b = spy.slice(50), yrs = (b.at(-1).t - b[0].t) / YEAR, daily = b.slice(1).map((x, i) => x.c / b[i].c - 1);
  const m = daily.reduce((a, c) => a + c, 0) / daily.length, sd = Math.sqrt(daily.reduce((a, c) => a + (c - m) ** 2, 0) / daily.length);
  let peak = 0, dd = 0; for (const x of b) { peak = Math.max(peak, x.c); dd = Math.max(dd, 1 - x.c / peak); }
  return { cagr: (b.at(-1).c / b[0].o) ** (1 / yrs) - 1, sharpe: m / sd * Math.sqrt(252), dd };
}

const window = (all, names, from, to) => {
  const cut = b => b.filter(x => x.t >= D(from) - 400 * 86400000 && x.t < D(to));   // 400 days of warmup bars before "from"
  const series = { SPY: cut(all.SPY) };
  for (const n of names) { const b = cut(all[n] || []); if (b.length > 260) series[n] = b; }
  // Score from "from": drop SPY days before it but keep 50 so evaluatePortfolio's own warmup ends at "from".
  const first = series.SPY.findIndex(x => x.t >= D(from)); series.SPY = series.SPY.slice(Math.max(0, first - 50));
  return series;
};

export async function main(argv = process.argv.slice(2)) {
  mkdirSync(DIR, { recursive: true });
  const refresh = argv.includes("--refresh"), outAt = argv.indexOf("--out");
  const symbols = ["SPY", ...new Set(Object.values(UNIVERSES).flatMap(u => u.names))], all = {};
  for (const s of symbols) all[s] = await fetchBars(s, refresh);
  const end = new Date(all.SPY.at(-1).t + 86400000).toISOString().slice(0, 10);
  const pct = x => `${(x * 100).toFixed(1)}%`, out = [], rows = [];
  const say = (...lines) => { for (const l of lines) { out.push(l); console.log(l); } };

  say(`# Richie stock rules on long history (${new Date().toISOString().slice(0, 10)})`, "");
  say(`Engine: strategy.mjs evaluatePortfolio, slippage 0.05% and spread 0.1% per side. Data: Yahoo daily bars, dividend adjusted, to ${end}.`);
  say(`Every variant: ${Object.keys(ENTRIES).length} entries x ${Object.keys(EXITS).length} exits x 3 or 5 slots x idle cash in cash or in SPY = ${Object.keys(ENTRIES).length * Object.keys(EXITS).length * 4} per universe.`, "");
  for (const [uName, u] of Object.entries(UNIVERSES)) {
    const full = window(all, u.names, u.from, end), first = window(all, u.names, u.from, u.split), second = window(all, u.names, u.split, end);
    const spy = spyStats(full.SPY), spy1 = spyStats(first.SPY), spy2 = spyStats(second.SPY);
    say(`## ${uName}${u.hindsight ? " (picked with hindsight, for comparison only)" : ""}: ${u.names.length} names, ${u.from.slice(0, 4)} to ${end.slice(0, 4)}`, "");
    say(`SPY held: ${pct(spy.cagr)} a year, Sharpe ${spy.sharpe.toFixed(2)}, worst drop ${pct(spy.dd)}. First half to ${u.split.slice(0, 4)}: ${pct(spy1.cagr)}; second half: ${pct(spy2.cagr)}.`, "");
    say("| Entry | Exit | Slots | Idle cash | Trades/yr | Yearly | vs SPY | Sharpe | Worst drop | Won | Avg trade (t) | 1st half | 2nd half |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    const runs = [];
    for (const [eName, signal] of Object.entries(ENTRIES)) for (const [xName, exit] of Object.entries(EXITS)) for (const slots of [3, 5]) for (const useCore of [false, true]) {
      const opts = { signal, slots, useCore, ...exit }, a = stats(full, opts), h1 = stats(first, opts), h2 = stats(second, opts);
      runs.push({ uName, eName, xName, slots, useCore, a, h1, h2, ex1: h1.cagr - spy1.cagr, ex2: h2.cagr - spy2.cagr });
    }
    runs.sort((x, y) => (y.a.cagr - y.a.spyCagr) - (x.a.cagr - x.a.spyCagr));
    for (const r of runs) say(`| ${r.eName} | ${r.xName} | ${r.slots} | ${r.useCore ? "SPY" : "cash"} | ${r.a.perYear.toFixed(0)} | ${pct(r.a.cagr)} | ${pct(r.a.cagr - spy.cagr)} | ${r.a.sharpe.toFixed(2)} | ${pct(r.a.dd)} | ${pct(r.a.win ?? 0)} | ${pct(r.a.mean)} (${r.a.t.toFixed(1)}) | ${pct(r.ex1)} | ${pct(r.ex2)} |`);
    // Walk forward: the variant a researcher would have picked on the first half, then scored on the second.
    for (const core of [false, true]) {
      const pool = runs.filter(r => r.useCore === core), pick = [...pool].sort((x, y) => y.ex1 - x.ex1)[0];
      const rank = [...pool].sort((x, y) => y.ex2 - x.ex2).indexOf(pick) + 1, beat2 = pool.filter(r => r.ex2 > 0).length;
      say("", `Walk forward (idle cash in ${core ? "SPY" : "cash"}): best on the first half was "${pick.eName} / ${pick.xName} / ${pick.slots} slots" at ${pct(pick.ex1)} a year vs SPY; on the second half it did ${pct(pick.ex2)}, rank ${rank} of ${pool.length}. ${beat2} of ${pool.length} variants beat SPY in the second half.`);
    }
    say("");
    rows.push(...runs);
  }
  const clean = rows.filter(r => !UNIVERSES[r.uName].hindsight);
  say("## Summary", "", `Variants on universes picked without hindsight: ${clean.length}. Beat SPY over the whole period: ${clean.filter(r => r.a.cagr > r.a.spyCagr).length}. Higher Sharpe than SPY: ${clean.filter(r => r.a.sharpe > spyStats(window(all, UNIVERSES[r.uName].names, UNIVERSES[r.uName].from, end).SPY).sharpe).length}.`);
  if (outAt >= 0) writeFileSync(argv[outAt + 1], out.join("\n") + "\n");
  return rows;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
