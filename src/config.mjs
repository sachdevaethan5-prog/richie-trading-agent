// Richie's settings. FIXED is the scope and the hard rules. SETTINGS and DECIDED are tunable choices.
// None of them is a trade cap, a trade quota or a position limit (those live in the playbook and core/lib.mjs gates).

export const FIXED = {
  products: { robinhood: ["stock", "etf", "crypto"], kalshi: ["event_contract"] },   // current scope, no expansion
  cashOnly: true,                    // no margin, no borrowing; an order never exceeds available cash
  monthlyAim: [0.05, 0.10],          // evaluation aspiration, never a promise
  telegramWords: 30,                 // default message: one or two short sentences, usually 30 words or fewer
};

export const SETTINGS = {
  // When a reading counts as stale: no exit or entry acts on it.
  freshness: { quoteMs: 60000, cryptoQuoteMs: 2 * 60000, kalshiQuoteMs: 2 * 60000, accountMs: 5 * 60000, brokerSyncMs: 5 * 60000 },
  // How often the monitor checks each open position.
  monitorIntervalMs: { stock: 60000, etf: 60000, crypto: 2 * 60000, event_contract: 2 * 60000 },
  // Bounded retry for Telegram and broker reads. Orders are never retried by this.
  retry: { attempts: 4, baseMs: 2000, maxMs: 5 * 60000 },
  // Research delegation: at most $0.25 a day; once spent, sessions run without delegated research.
  research: { provider: "disabled", maxWorkers: 3, maxMs: 90000, maxCallsPerWorker: 6, dailyUsd: 0.25 },   // live sessions pass their own workers (live-sessions.mjs researchTool)
};

export const DECIDED = {
  review: "deepseek",                // a buy needs DeepSeek's PASS (exits need none)
  promotion: "approval",             // a version that passes is shown to the owner; it goes live only on their yes
  promotionCriteria: { minTrades: 30, beatBenchmarkAfterCosts: true, maxDrawdown: 0.25, maxMissedChecks: 0.05 },
  legacyGates: "keep",               // stay live until the evaluation on real history shows a change; each change goes to the owner
  dashboardAccess: "local",        // 127.0.0.1 by default; optional remote access behind Cloudflare Access (server.mjs)
  dashboardControls: "built",        // pause/resume, run session, sell now (CONTROLS.md)
  telegram: "send-only",             // watch-only mode sends through Richie's bot and never reads it
  robinhoodSignIn: "own",            // one sign-in (signin.mjs); run only one of live.mjs and runner.mjs at a time
  // Stocks (playbook core-trail-1): code keeps coreShare of the Robinhood account in the core, bought from cash and
  // never sold to fund or rebalance. The rest is Richie's trading money: new stock and ETF satellites exit only on a
  // trailing stop this far under the highest close. minOrder is Robinhood's smallest fractional order.
  // You choose Richie's share with RICHIE_TRADING_PERCENT (see .env.example and the README).
  stocks: { core: "SPY", coreShare: 1 - tradingPercent(process.env.RICHIE_TRADING_PERCENT) / 100, trail: 0.2, minOrder: 1 },
};

// RICHIE_TRADING_PERCENT: the share of the Robinhood account Richie trades himself, a whole number from 0 to 100.
// The rest is held in SPY by code. 20 is the default: in the long-history test (docs/history-backtest.md) 20% trailed
// SPY by 0.1 to 1.3 points a year, and a bigger share cost more (65%: 0.7 to 4.7 points a year since 2015).
// 0 means all SPY; 100 means no core, the old "idle cash stays in cash".
export function tradingPercent(value) {
  if (value == null || String(value).trim() === "") return 20;
  const n = Number(String(value).trim().replace(/%$/, ""));
  if (!Number.isInteger(n) || n < 0 || n > 100) throw Error(`RICHIE_TRADING_PERCENT must be a whole number from 0 to 100 (got "${value}")`);
  return n;
}

// Execution is observation-only unless a caller passes exactly "live". Only live.mjs does, started with --live.
export const EXECUTION_MODE = "observe";
