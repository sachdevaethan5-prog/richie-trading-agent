// Read-only broker views for the observation runner: balances, quotes and daily bars. Positions and order
// states come from the execution adapters' positions() and lookup(), which only read. Field names follow what
// the live code already parses (src/core/lib.mjs); quote times use the broker's own timestamp
// when it gives one, so an after-hours or frozen quote shows as stale instead of fresh.
import { rowsOf, symbolOfRow, priceOfRow, portfolioOf, toolKind } from "../core/lib.mjs";

const num = v => v === undefined || v === null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null;

// The runner's only path to Robinhood: look-only tools, everything else refused before it leaves the process.
export const readOnlyRobinhood = rh => ({ call: (name, args) => toolKind(name) === "read" ? rh.call(name, args) : Promise.reject(Error(`Observation runner: ${name} is not a look-only tool`)) });
export const readOnlyKalshi = ks => ({ get: path => ks.get(path), post: () => Promise.reject(Error("Observation runner: Kalshi writes are refused")) });

export function robinhoodReader(rh, account, { now = Date.now } = {}) {
  return {
    broker: "robinhood",
    async account() {
      const p = portfolioOf(await rh.call("get_portfolio", { account_number: account.account_number }));
      if (!Number.isFinite(p.cash)) throw Error("Robinhood portfolio answer had no cash figure (malformed)");
      return { broker: "robinhood", accountRef: account.account_number, cash: p.cash, value: Number.isFinite(p.value) ? p.value : null, source: "robinhood get_portfolio", asOf: now() };
    },
    // positions: ledger rows. Returns quote rows for the monitor.
    async quotes(positions) {
      const out = [], at = now();
      for (const crypto of [false, true]) {
        const syms = positions.filter(p => p.broker === "robinhood" && (p.instrument_type === "crypto") === crypto).map(p => p.instrument);
        if (!syms.length) continue;
        const rows = rowsOf(await rh.call(crypto ? "get_crypto_quotes" : "get_equity_quotes", { symbols: syms.map(s => crypto ? `${s}-USD` : s) }));
        for (const r of rows) {
          const instrument = symbolOfRow(r), stamp = Date.parse(r.updated_at ?? r.venue_timestamp ?? "");
          if (!syms.includes(instrument)) continue;
          out.push({ broker: "robinhood", instrument, price: Number.isFinite(priceOfRow(r)) ? priceOfRow(r) : null, bid: num(r.bid_price), ask: num(r.ask_price),
            asOf: Number.isFinite(stamp) ? Math.min(stamp, at) : at, source: `robinhood ${crypto ? "get_crypto_quotes" : "get_equity_quotes"}` });
        }
      }
      return out;
    },
    async dailyBars(symbol, days = 60) {
      const start = new Date(now() - days * 86400000).toISOString().slice(0, 10) + "T00:00:00Z";
      const r = await rh.call("get_equity_historicals", { symbols: [symbol], start_time: start, interval: "day" });
      const x = ((typeof r === "string" ? JSON.parse(r) : r)?.data?.results || []).find(s => String(s.symbol ?? symbol).toUpperCase() === symbol) ;
      return (x?.bars || []).map(b => ({ t: Date.parse(b.begins_at), o: +b.open_price, h: +b.high_price, l: +b.low_price, c: +b.close_price, v: +b.volume })).filter(b => Number.isFinite(b.t) && b.c > 0);
    },
  };
}

// Kalshi prices are in dollars per contract of each side; a held side is valued at its own bid.
// /portfolio/balance has its own bucket: 1 call a second, no burst (Kalshi OpenAPI 3.35.0). The account job and
// reconcile's refresh after a booked order read it in the same second on 2026-11-02 (22:05:14Z) and got 429, so reads
// here go one at a time, at least BALANCE_GAP_MS apart.
export const BALANCE_GAP_MS = 1100;
export function kalshiReader(ks, { now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let queue = Promise.resolve(), last = -Infinity;
  const balance = () => {
    const turn = queue.then(async () => {
      const wait = last + BALANCE_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      try { return await ks.get("/portfolio/balance"); } finally { last = Date.now(); }
    });
    queue = turn.catch(() => {});
    return turn;
  };
  return {
    broker: "kalshi",
    async account() {
      const b = await balance();
      if (!Number.isFinite(Number(b.balance))) throw Error("Kalshi balance answer had no balance (malformed)");
      return { broker: "kalshi", accountRef: null, cash: b.balance / 100, value: (b.balance + (Number(b.portfolio_value) || 0)) / 100, source: "kalshi /portfolio/balance", asOf: now() };
    },
    async quotes(positions) {
      const out = [];
      for (const p of positions.filter(p => p.broker === "kalshi")) {
        // One market Kalshi will not serve (a combo read seconds after it was made answered 404, 2026-11-03) leaves only
        // that position without a quote (its own stale alert); it never stops the watch on the others.
        const one = await ks.get(`/markets/${encodeURIComponent(p.instrument)}`).catch(error => { if (/Kalshi 404:/.test(String(error.message))) return {}; throw error; });
        const m = one.market;
        if (!m) continue;
        const side = p.side === "no" ? "no" : "yes";
        const last = num(m.last_price_dollars);   // the YES side's last trade
        // A closed or decided market has no book (its bid reads 0): the held side is worth its result, and no exit can trade.
        const decided = ["yes", "no"].includes(m.result), status = String(m.status || "");
        const worth = m.result === side ? 1 : 0;
        out.push({ broker: "kalshi", instrument: p.instrument, price: decided ? worth : last == null ? null : side === "yes" ? last : 1 - last,
          bid: decided ? worth : num(m[`${side}_bid_dollars`]), ask: decided ? worth : num(m[`${side}_ask_dollars`]), status, asOf: now(), source: "kalshi /markets" });
      }
      return out;
    },
  };
}
