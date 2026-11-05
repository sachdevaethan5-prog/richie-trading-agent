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
  promotion: "automatic",            // a version that passes goes live, and the owner is told afterwards
  promotionCriteria: { minTrades: 30, beatBenchmarkAfterCosts: true, maxDrawdown: 0.25, maxMissedChecks: 0.05 },
  legacyGates: "keep",               // stay live until the evaluation on real history shows a change; each change goes to the owner
  dashboardAccess: "local",        // 127.0.0.1 by default; optional remote access behind Cloudflare Access (server.mjs)
  dashboardControls: "built",        // pause/resume, run session, sell now (CONTROLS.md)
  telegram: "send-only",             // watch-only mode sends through Richie's bot and never reads it
  robinhoodSignIn: "own",            // one sign-in (signin.mjs); run only one of live.mjs and runner.mjs at a time
};

// Execution is observation-only unless a caller passes exactly "live". Only live.mjs does, started with --live.
export const EXECUTION_MODE = "observe";
