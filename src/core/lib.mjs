// Richie's shared rules and broker helpers, used by live Richie (rebuild/). These rules are code, not prompt.
// The legacy bot's per-buy share, position and daily counts, drawdown halt and order gates (orderProblem,
// kalshiOrderProblem) were retired by the owner on 2026-11-02 and nothing called them; they were deleted on 2026-11-03.
// The order policy is rebuild/policy.mjs, the kept case gates rebuild/sessions.mjs gateProblem.

export const LIMITS = {
  paperDays: 20,           // a paper trade still open after this many days is closed at the price then
};

// Robinhood's tools (90 on 2026-10-14), by exact name. Anything not listed is blocked: options,
// margin upgrades, transfers, watchlist/alert/scan/chart writes, trade-approval answers, new tools.
const ALLOWED = {
  read: ["get_accounts", "get_portfolio", "get_equity_positions", "get_crypto_positions", "get_equity_orders", "get_crypto_orders", "get_advanced_orders",
    "get_equity_quotes", "get_crypto_quotes", "get_currency_pairs", "get_equity_historicals", "get_equity_technical_indicators", "get_equity_fundamentals",
    "get_equity_analyst_ratings", "get_earnings_results", "get_equity_tradability", "get_realized_pnl", "search", "get_popular_watchlists",
    "get_watchlist_items", "get_indexes", "get_index_quotes"],   // kept short: every tool's description is resent each step
  preview: ["review_equity_order", "preview_crypto_order", "review_advanced_order"],
  order: ["place_equity_order", "place_crypto_order", "place_advanced_order"],
  cancel: ["cancel_equity_order", "cancel_crypto_order", "cancel_advanced_order"],
};
export function toolKind(name) {
  for (const [kind, names] of Object.entries(ALLOWED)) if (names.includes(name)) return kind;
  return "blocked";
}
// The account fields the code fills in itself, so the model never picks an account.
export const ACCOUNT_FIELDS = ["account_number", "rhs_account_number"];

// A research case, written before any buy. Crypto needs more.
export function caseProblem(c) {
  if (!c || typeof c !== "object") return "no case";
  for (const k of ["symbol", "thesis", "entry", "stop", "target", "invalidation"]) if (!String(c[k] ?? "").trim()) return `the case needs ${k}`;
  const [entry, stop, target] = ["entry", "stop", "target"].map(k => Number(c[k]));
  if (![entry, stop, target].every(Number.isFinite)) return "entry, stop and target must be prices";
  if (!(stop < entry && target > entry)) return "the stop must be below the entry and the target above it";
  if ((entry - stop) / entry > 0.15) return "the stop is more than 15% below the entry; size the risk smaller";
  if (!Array.isArray(c.sources) || c.sources.length < 2) return "the case needs at least 2 sources (market data, news)";
  if (c.kind === "crypto") {
    if (!String(c.catalyst ?? "").trim()) return "a crypto case needs a recent catalyst";
    if (!String(c.trend_30d ?? "").trim()) return "a crypto case needs the 30-day trend";
    if (c.sources.length < 3) return "a crypto case needs at least 3 sources";
  }
  return null;
}

// Grounding (borrowed from Vibe-Trading): a case's price must match the live market, checked by code before
// any model sees it, so a made-up or stale entry never reaches DeepSeek or Codex. No live price means no case.
export const GROUND = { stock: 0.02, crypto: 0.03, kalshi: 0.02 };   // stocks and crypto relative, Kalshi in dollars
export function entryOffProblem(entry, live, kind) {
  if (!(live > 0)) return "could not read a live price for it, so the entry can't be checked. Try again or move on";
  const tol = kind === "crypto" ? GROUND.crypto : GROUND.stock, gap = Math.abs(entry - live) / live;
  return gap > tol ? `the entry ${entry} is ${(gap * 100).toFixed(1)}% from the live price ${live}; write the case at the real price` : null;
}
export function kalshiPriceOffProblem(price, ask) {
  if (!(ask > 0)) return "could not read the live ask for your side, so the price can't be checked. Try again or move on";
  return Math.abs(price - ask) > GROUND.kalshi + 1e-9 ? `your price ${price} is not the live ask ${ask} for your side; write the case at the real price` : null;
}

// The scoreboard: closed trades ({ret, dollars}) as win rate, average win and loss, and dollars made.
// Real trades and paper trades are scored the same way, separately.
export function scoreboard(trades = []) {
  const done = trades.filter(t => Number.isFinite(t.ret));
  if (!done.length) return { count: 0, line: "no closed trades yet" };
  const wins = done.filter(t => t.ret > 0), losses = done.filter(t => t.ret <= 0);
  const avg = list => list.length ? list.reduce((a, t) => a + t.ret, 0) / list.length : 0;
  const dollars = done.reduce((a, t) => a + (Number(t.dollars) || 0) * t.ret, 0);
  const pct = x => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const out = { count: done.length, winRate: wins.length / done.length, avgWin: avg(wins), avgLoss: avg(losses), dollars };
  out.line = `${done.length} closed, ${wins.length} won (${Math.round(out.winRate * 100)}%), average win ${pct(out.avgWin)}, average loss ${pct(out.avgLoss)}${trades.some(t => t.dollars) ? `, about $${dollars.toFixed(2)} made` : ""}`;
  return out;
}

// Paper trades: a setup he looked at and didn't buy, tracked for free with the same stop and target.
// Closed at the stop, the target, or after LIMITS.paperDays at the price then.
export function paperExit(p, price, now) {
  const why = exitFor(p, price);
  if (why) return why;
  if (Number.isFinite(price) && now - p.at >= LIMITS.paperDays * 86400000) return "time";
  return null;
}

// Value and cash from get_portfolio's answer ({"data":{"total_value":"10","cash":"10",...}}).
export function portfolioOf(text) {
  try { const d = JSON.parse(String(text)).data; return { value: Number(d.total_value), cash: Number(d.cash) }; } catch { return { value: NaN, cash: NaN }; }
}
// The one account Robinhood lets this agent trade, from get_accounts.
export function agenticAccount(text) {
  try { return (JSON.parse(String(text)).data?.accounts || []).find(a => a.agentic_allowed === true) || null; } catch { return null; }
}

// The stop watcher (plain code, no model): rows of a Robinhood list answer, and a symbol or price
// from a row whatever the field is called. Robinhood sends numbers as strings.
export function rowsOf(text) {
  try {
    const d = JSON.parse(String(text)).data ?? {};
    const list = Array.isArray(d) ? d : d.positions || d.results || d.quotes || d.items || Object.values(d).find(Array.isArray) || [];
    // Equity quotes come as {quote: {...}, close: {...}} (2026-10-14: the watcher could not read a single price before this).
    return list.filter(r => r && typeof r === "object").map(r => r.quote && typeof r.quote === "object" ? { ...r.quote, close: r.close } : r);
  } catch { return []; }
}
const num = (row, keys) => { for (const k of keys) { const v = Number(row?.[k]); if (row?.[k] !== undefined && row[k] !== null && row[k] !== "" && Number.isFinite(v)) return v; } return NaN; };
export const symbolOfRow = r => String(r.symbol ?? r.asset_code ?? r.currency_code ?? r.asset ?? r.instrument_symbol ?? "").toUpperCase().replace(/-?USD$/, "");
export const priceOfRow = r => num(r, ["last_trade_price", "mark_price", "mark", "last_extended_hours_trade_price", "price", "bid_price"]);

// Kalshi: event contracts, each paying $1 or $0, bet on his own odds against the price.
export const KALSHI = {
  minEdge: 0.05,       // his odds must beat the price by 5 cents after the fee
  // A parlay's edge is relative instead: 15% of its price after the fee. A flat
  // 5 cents on a 0.086 combo meant believing it 70% likelier than the market, which the skill's per-leg caps never allow.
  parlayEdgeShare: 0.15,
};
// The edge a case must clear at this price: 5 cents for a single bet, 15% of the price for a parlay.
export const kalshiEdgeNeeded = (ticker, price) => isCombo(ticker) ? KALSHI.parlayEdgeShare * Number(price) : KALSHI.minEdge;
// Kalshi's trading fee, rounded up to the cent: 7% of count x price x (1 - price).
export const kalshiFee = (count, price) => Math.ceil(0.07 * count * price * (1 - price) * 100 - 1e-9) / 100;

// A bet's case. price: what one contract of his side costs now; fair: his chance that side wins.
export function kalshiCaseProblem(c) {
  if (!c || typeof c !== "object") return "no case";
  for (const k of ["ticker", "side", "thesis", "resolves", "invalidation"]) if (!String(c[k] ?? "").trim()) return `the case needs ${k}`;
  if (!["yes", "no"].includes(c.side)) return "side is yes or no";
  const price = Number(c.price), fair = Number(c.fair);
  if (!(price >= 0.01 && price <= 0.99)) return "price is what one contract of your side costs now, 0.01 to 0.99";
  if (!(fair > 0 && fair < 1)) return "fair is your own chance that your side wins, between 0 and 1";
  const edge = fair - price - kalshiFee(1, price);
  const need = kalshiEdgeNeeded(c.ticker, price);
  if (edge < need) return `your edge after the fee is ${(edge * 100).toFixed(1)} cents; it needs at least ${(need * 100).toFixed(1)}${isCombo(c.ticker) ? ` (${KALSHI.parlayEdgeShare * 100}% of the parlay's price)` : ""}`;
  if (!Array.isArray(c.sources) || c.sources.length < 3) return "the case needs at least 3 sources (the market's rules, data or news on the event)";
  if (c.stop != null || c.target != null) {
    const [stop, target] = [Number(c.stop), Number(c.target)];
    if (!(stop < price && target > price && target < 1)) return "the stop must be below the price and the target above it and under 1";
  }
  return null;
}

// Kalshi quotes everything from the YES side: bid buys YES, ask sells YES (which, held as none,
// buys NO at 1 - price). Sells are reduce_only, so a sell can never open the other side.
export function kalshiOrderBody(o, id) {
  const yesPrice = o.side === "yes" ? Number(o.price) : 1 - Number(o.price);
  return { ticker: o.ticker, client_order_id: id, side: (o.side === "yes") !== Boolean(o.sell) ? "bid" : "ask", count: (Math.floor(Number(o.count) * 100 + 1e-6) / 100).toFixed(2),
    price: yesPrice.toFixed(2), time_in_force: "immediate_or_cancel", self_trade_prevention_type: "taker_at_cross", reduce_only: Boolean(o.sell) };
}
// Kalshi parlays. A parlay is a combo market made on demand in a
// multivariate collection; it has no order book, so its price comes from market makers through an RFQ. All NFL legs
// sit in this collection (checked live 2026-11-03), and it pays YES only if every leg resolves YES.
export const COMBO_COLLECTION = "KXMVECROSSCATEGORY-R";
export const isCombo = ticker => /^KXMVE/i.test(String(ticker || ""));
// A quote carries the maker's yes_bid and no_bid. The requester buys YES by accepting the maker's NO quote and pays
// 1 minus no_bid ("BUY accepts the maker's NO quote", Kalshi FIX RFQ docs, read 2026-11-03).
export const comboYesCost = q => Number(q?.no_bid_dollars) > 0 ? Math.round((1 - Number(q.no_bid_dollars)) * 10000) / 10000 : null;
export function bestComboQuote(quotes = []) {
  return quotes.filter(q => q.status === "open" && comboYesCost(q) != null).sort((a, b) => comboYesCost(a) - comboYesCost(b))[0] ?? null;
}

// Sell when the price is at or under the stop, or at or over the target.
export function exitFor(held, price) {
  if (!held || !Number.isFinite(price)) return null;
  if (price <= Number(held.stop)) return "stop";
  if (price >= Number(held.target)) return "target";
  return null;
}
