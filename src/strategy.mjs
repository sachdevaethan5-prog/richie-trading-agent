// Strategy versions and offline evaluation. A strategy is a versioned rule set evaluated
// on historical or paper data with costs. A version that meets DECIDED.promotionCriteria is promoted automatically
// and the owner is told afterwards; promotionCheck() is the whole test.
import { DECIDED } from "./config.mjs";

// The legacy case gates from src/core/lib.mjs. The owner kept them live (2026-11-02; sessions.mjs gateProblem applies
// them through lib.mjs) until an evaluation on real history shows a change, and each change goes to the owner.
export const LEGACY_GATES = {
  version: "legacy-gates-2026-10-20 (kept live, unevaluated)",
  caseMaxAgeMs: { value: 2 * 3600000, why: "A case older than this may rest on stale prices; intraday the right age is probably shorter." },
  kalshiMinEdge: { value: 0.05, why: "Fair chance minus price minus fee must clear this; tests whether small edges are noise." },
  kalshiParlayEdgeShare: { value: 0.15, why: "A parlay's edge must be this share of its price instead; tests whether cheap parlays pay." },
  kalshiChase: { value: 0.02, why: "Do not buy more than this above the case price; the edge was computed at that price." },
  groundStock: { value: 0.02, why: "A case entry this far from the live quote is refused before any model sees it." },
  groundCrypto: { value: 0.03, why: "Same, for crypto." },
  kalshiPriceBand: { value: [0.05, 0.95], why: "Guidance in playbook.md, not enforced in code. Long shots and near-certainties lose most to the fee. Legacy horizon 1 to 14 days conflicts with intraday and needs a benchmark." },
};

// Bars: [{ t, o, h, l, c, v }] oldest first, any interval. signal(bars, i) may read only bars[0..i]; it returns
// { stop, target, maxBars, exit? } or null; exit(bars[0..j], j) is an optional closing rule (exit at that close). Entry is the next bar's open plus slippage, so a signal can never trade on a
// price it has not seen. costs: { feePerTrade, slippage (fraction), spread (fraction) }.
export function evaluate(bars, signal, { costs = {}, cash = 1, sizeFraction = 1 } = {}) {
  const { feePerTrade = 0, slippage = 0, spread = 0 } = costs, friction = slippage + spread / 2;
  const trades = [];
  let equity = cash, peak = cash, maxDrawdown = 0, exposureBars = 0, turnover = 0;
  for (let i = 0; i < bars.length - 1; i++) {
    const s = signal(bars.slice(0, i + 1), i);   // the slice is the lookahead guard
    if (!s) continue;
    const entry = bars[i + 1].o * (1 + friction);
    let exit = null, j = i + 1, why = "time";
    for (; j < bars.length; j++) {
      const b = bars[j];
      if (b.l <= s.stop) { exit = Math.min(s.stop, b.o); why = "stop"; break; }     // stop first: a bar touching both is a loss
      if (b.h >= s.target) { exit = Math.max(s.target, b.o); why = "target"; break; }
      if (s.exit && s.exit(bars.slice(0, j + 1), j)) { exit = b.c; why = "rule"; break; }   // a trailing rule sees only bars up to j
      if (s.maxBars && j - i >= s.maxBars) { exit = b.c; break; }
    }
    if (exit == null) break;   // still open at the end: not scored
    exit *= 1 - friction;
    const stake = equity * sizeFraction, units = stake / entry;
    const pnl = units * (exit - entry) - 2 * feePerTrade;
    equity += pnl; turnover += stake + units * exit; exposureBars += j - i;
    peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, (peak - equity) / peak);
    trades.push({ signalAt: bars[i].t, entryAt: bars[i + 1].t, exitAt: bars[j].t, entry, exit, why, ret: exit / entry - 1, pnl, bars: j - i });
    i = j;
  }
  const wins = trades.filter(t => t.pnl > 0).length;
  return { trades, count: trades.length, netReturn: equity / cash - 1, winRate: trades.length ? wins / trades.length : null, maxDrawdown,
    exposure: bars.length ? exposureBars / bars.length : 0, turnover: turnover / cash,
    // A small sample says little. The report says so instead of ranking on it.
    sampleNote: trades.length < 30 ? `Only ${trades.length} trades: too few to tell skill from luck.` : null };
}

export const buyAndHold = bars => bars.length > 1 ? bars.at(-1).c / bars[0].o - 1 : 0;

// Kalshi calibration: Brier score of Richie's fair chances against outcomes (0 is perfect, 0.25 is a coin flip).
export function brier(cases) {
  const done = cases.filter(c => Number.isFinite(c.fair) && (c.outcome === 0 || c.outcome === 1));
  return done.length ? done.reduce((s, c) => s + (c.fair - c.outcome) ** 2, 0) / done.length : null;
}

// One report: paper and live never mixed, benchmark beside the result, and the open promotion decision stated.
export function evaluationReport({ version, live, paper, benchmark }) {
  const line = (label, r) => r ? `${label}: ${r.count} trades, net ${(r.netReturn * 100).toFixed(2)}%, max drawdown ${(r.maxDrawdown * 100).toFixed(2)}%, exposure ${(r.exposure * 100).toFixed(0)}% of bars${r.sampleNote ? `. ${r.sampleNote}` : ""}` : `${label}: no data`;
  return [`Strategy ${version}`, line("Live", live), line("Paper", paper), `Benchmark (buy and hold): ${(benchmark * 100).toFixed(2)}%`,
    "Promotion: automatic when the paper result passes the promotion criteria; the owner is told afterwards."].join("\n");
}

// result: evaluate() output; benchmark: buy-and-hold over the same bars; missedRate: share of monitor checks missed
// while the version ran on paper. Every criterion must hold; the reasons say which did not.
export function promotionCheck(result, { benchmark, missedRate }, c = DECIDED.promotionCriteria) {
  const reasons = [];
  if (!(result?.count >= c.minTrades)) reasons.push(`${result?.count ?? 0} trades, needs ${c.minTrades}`);
  if (c.beatBenchmarkAfterCosts && !(result?.netReturn > benchmark)) reasons.push(`net ${((result?.netReturn ?? 0) * 100).toFixed(2)}% does not beat buy and hold ${(benchmark * 100).toFixed(2)}%`);
  if (!(result?.maxDrawdown <= c.maxDrawdown)) reasons.push(`max drawdown ${((result?.maxDrawdown ?? 1) * 100).toFixed(1)}% is over ${c.maxDrawdown * 100}%`);
  if (!(missedRate <= c.maxMissedChecks)) reasons.push(`${Number.isFinite(missedRate) ? (missedRate * 100).toFixed(1) : "unknown"}% of checks missed, limit ${c.maxMissedChecks * 100}%`);
  return { pass: !reasons.length, reasons };
}

// A whole-portfolio test (the per-symbol evaluate() above says nothing about idle cash). series: { SYMBOL: bars } on
// shared dates, with the core symbol among them. Each day: open satellites exit on their stop or target (intraday,
// a gap fills at the open), a close under the 20-day, or maxBars; then satellites signalled today are bought at the
// next open, each 1/slots of equity, funded from the core; leftover cash goes to the core at that open. signal(bars, i)
// sees only bars up to i. costs are charged on every buy and sell.
export function evaluatePortfolio(series, { signal, slots = 3, core = "SPY", useCore = true, stop = 0.07, target = 0.14, maxBars = 20, costs = {} } = {}) {
  const cost = (costs.slippage || 0) + (costs.spread || 0) / 2, days = series[core].map(b => b.t);
  const idx = Object.fromEntries(Object.entries(series).map(([s, b]) => [s, new Map(b.map((x, i) => [x.t, i]))]));
  const px = (s, d, k = "c") => { const i = idx[s].get(d); return i == null ? null : series[s][i][k]; };
  const sma20 = (b, i) => { if (i < 19) return NaN; let t = 0; for (let j = i - 19; j <= i; j++) t += b[j].c; return t / 20; };
  let cash = 1, coreUnits = 0, peak = 1, maxDrawdown = 0; const pos = new Map(), trades = [];
  const equity = d => cash + coreUnits * (px(core, d) ?? 0) + [...pos].reduce((t, [s, p]) => t + p.units * (px(s, d) ?? p.entry), 0);
  for (let k = 50; k < days.length - 1; k++) {
    const d = days[k], next = days[k + 1];
    for (const [s, p] of [...pos]) {
      const i = idx[s].get(d); if (i == null) continue;
      const b = series[s][i]; let exit = null;
      if (b.l <= p.entry * (1 - stop)) exit = Math.min(p.entry * (1 - stop), b.o);
      else if (b.h >= p.entry * (1 + target)) exit = Math.max(p.entry * (1 + target), b.o);
      else if (k - p.k >= maxBars || b.c < sma20(series[s], i)) exit = b.c;
      if (exit != null) { cash += p.units * exit * (1 - cost); trades.push({ symbol: s, ret: exit * (1 - cost) / p.entry - 1 }); pos.delete(s); }
    }
    const eq = equity(d);
    for (const s of Object.keys(series)) {
      if (pos.size >= slots || pos.has(s) || s === core) continue;
      const i = idx[s].get(d), open = px(s, next, "o");
      if (i == null || open == null || !signal(series[s].slice(0, i + 1), i)) continue;
      const stake = eq / slots;
      if (cash < stake && coreUnits > 0) { const sell = px(core, next, "o") * (1 - cost), u = Math.min(coreUnits, (stake - cash) / sell); coreUnits -= u; cash += u * sell; }
      const spend = Math.min(stake, cash); if (spend <= 1e-9) break;
      const entry = open * (1 + cost); pos.set(s, { units: spend / entry, entry, k: k + 1 }); cash -= spend;
    }
    if (useCore && cash > 1e-9 && px(core, next, "o")) { coreUnits += cash * (1 - cost) / px(core, next, "o"); cash = 0; }
    const e = equity(next); peak = Math.max(peak, e); maxDrawdown = Math.max(maxDrawdown, 1 - e / peak);
  }
  const wins = trades.filter(t => t.ret > 0).length;
  return { netReturn: equity(days.at(-1)) - 1, maxDrawdown, count: trades.length, winRate: trades.length ? wins / trades.length : null, trades,
    benchmark: series[core].at(-1).c / series[core][50].o - 1,
    sampleNote: trades.length < 30 ? `Only ${trades.length} trades: too few to tell skill from luck.` : null };
}
