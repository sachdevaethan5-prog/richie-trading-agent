// Execution adapters over the existing broker connections (src/core/robinhood.mjs, src/core/kalshi.mjs), which are
// reused unchanged: same allowlisted Robinhood tools, same Keychain key handling, no new endpoints for Robinhood.
// Nothing in the rebuild connects these to a live transport yet. Tests drive them with fake transports, and
// submitOrder() refuses to call place() outside "live" mode.
// UNVERIFIED against the live APIs (check before observation mode): the Kalshi order-list path and its
// client_order_id field, and every state name below beyond the ones the legacy code already handles.
import { brokerRows } from "../core/broker-state.mjs";
import { kalshiOrderBody, symbolOfRow, isCombo, comboYesCost } from "../core/lib.mjs";

// States from the get_equity_orders schema (2026-11-02). pending_cancelled is still live until Robinhood confirms the cancel.
const RH_STATE = { new: "submitted", queued: "submitted", unconfirmed: "submitted", confirmed: "submitted", locating: "submitted", pending_cancelled: "submitted",
  partially_filled: "partially_filled", filled: "filled", cancelled: "cancelled", canceled: "cancelled", partially_filled_rest_cancelled: "cancelled",
  rejected: "rejected", failed: "rejected", locate_failed: "rejected", voided: "cancelled" };
// Robinhood can store an order under its own ref_id instead of the one sent (seen 2026-11-02 on the DVN market sell: sent
// Richie's client id, stored a server UUIDv7). An order is then matched by symbol, side, size and creation time instead.
const MATCH_BEFORE_MS = 5000, MATCH_AFTER_MS = 120000;
const MAX_PAGES = 20;

// Ledger quantities carry float dust after a partial sale (0.039483000000000004); Robinhood shows share counts to 6
// decimals and crypto to 8, so the count is sent rounded to those. A sale rounds down, so it never asks for more than
// is held (Robinhood refuses that, and the watcher would resend it every minute). Dollar amounts go in whole cents,
// rounded down. The 3-decimal step first keeps 0.0394829999999 from flooring a whole unit short.
const floorTo = (x, places) => { const f = 10 ** places; return Math.floor(Number((Number(x) * f).toFixed(3))) / f; };
const sentQuantity = (o, crypto) => o.side === "sell" ? floorTo(o.quantity, crypto ? 8 : 6) : Number(Number(o.quantity).toFixed(crypto ? 8 : 6));
const sentNotional = o => floorTo(o.notional, 2);

// rh: { call(name, args) } from src/core/robinhood.mjs connect(). account: the agentic account row.
export function robinhoodAdapter(rh, account) {
  const scope = crypto => crypto ? { rhs_account_number: account.rhs_account_number || account.account_number } : { account_number: account.account_number };
  const isCrypto = o => (o.instrument_type || o.instrumentType) === "crypto";
  return {
    broker: "robinhood",
    async place(o) {
      const crypto = isCrypto(o);
      // Exits go at market by share count, as the legacy watcher's did (fractional shares; Robinhood's OCO needs whole ones).
      // Robinhood refuses a limit order for a fractional stock quantity (2026-11-02, DVN), so whatever the caller asked,
      // a fractional stock order goes at market. Crypto takes fractional limits.
      const quantity = String(sentQuantity(o, crypto));
      const fractionalStock = !crypto && !Number.isInteger(Number(quantity));
      const size = o.notional ? { dollar_amount: String(sentNotional(o)), type: "market" } : o.orderType === "market" || fractionalStock ? { quantity, type: "market" }
        : { quantity, type: "limit", limit_price: String(o.limitPrice) };
      const args = { ...scope(crypto), symbol: o.instrument, side: o.side, ref_id: o.clientId, ...size, ...(crypto ? {} : { time_in_force: "gfd", market_hours: "regular_hours" }) };
      // The reply is { data: { order: {...} } } (place_equity_order's output schema); reading data itself gave no state or id.
      try { const data = JSON.parse(await rh.call(crypto ? "place_crypto_order" : "place_equity_order", args)).data ?? {}; return robinhoodView(data.order ?? data); }
      catch (error) {
        // Validation refusals only; 401/403 may be transient auth. Robinhood's tool errors read "API error 400: ..."
        // (seen 2026-11-02 on a fractional limit sell); before this they were booked as unknown and blocked the next sell.
        if (/Robinhood MCP (400|422):|API error (400|422)\b/.test(String(error.message))) error.rejected = true;
        throw error;
      }
    },
    // Finds one order: by Robinhood's order id once known, else by ref_id, else by the one unclaimed agent order with the
    // same symbol, side and size created just after the intent (claimed: broker ids other ledger orders already hold).
    // More than one such candidate stays unknown. An incomplete list is an error, never "not found".
    async lookup(o, { claimed = new Set() } = {}) {
      const crypto = isCrypto(o), prefix = crypto ? "crypto" : "equity";
      if (o.broker_id && !crypto) {
        const [row] = brokerRows(await rh.call("get_equity_orders", { ...scope(false), order_id: o.broker_id }), "orders");
        return row ? robinhoodView(row) : null;
      }
      const from = o.created_at - MATCH_BEFORE_MS, to = o.created_at + MATCH_AFTER_MS, near = [];
      // Compared with what place() sent, which is rounded.
      const sameSize = r => o.notional != null ? Math.abs(Number(r.dollar_based_amount?.amount ?? r.dollar_based_amount) - sentNotional(o)) < 0.005
        : Math.abs(Number(r.quantity) - sentQuantity({ side: o.side, quantity: o.requested_qty }, crypto)) < 1e-9;
      const candidate = r => { const at = Date.parse(r.created_at); return at >= from && at <= to && r.side === o.side && symbolOfRow(r) === o.instrument
        && r.agent_initiated !== false && !claimed.has(r.id) && sameSize(r); };
      let cursor;
      for (let page = 0; page < MAX_PAGES; page++) {
        const raw = await rh.call(`get_${prefix}_orders`, { ...scope(crypto), ...(crypto ? {} : { created_at_gte: new Date(from).toISOString() }), ...(cursor ? { cursor } : {}) });
        const rows = brokerRows(raw, "orders");
        const hit = rows.find(r => r.ref_id === o.client_id);
        if (hit) return robinhoodView(hit);
        near.push(...rows.filter(candidate));
        const parsed = JSON.parse(raw);
        cursor = parsed.data?.next ?? parsed.next;
        // Newest first: once a page reaches orders older than the window, later pages cannot hold a match.
        if (!cursor || rows.some(r => Date.parse(r.created_at) < from)) break;
        if (page === MAX_PAGES - 1) throw Error("Robinhood order pagination incomplete");
      }
      return near.length === 1 ? { ...robinhoodView(near[0]), reason: "matched by symbol, side, size and time (Robinhood kept its own ref_id)" } : null;
    },
    async positions() {
      const rows = [];
      for (const crypto of [false, true]) rows.push(...brokerRows(await rh.call(crypto ? "get_crypto_positions" : "get_equity_positions", scope(crypto)), "positions"));
      // average_buy_price is Robinhood's own cost per share (seen on equity positions, 2026-11-02).
      return rows.map(r => ({ instrument: symbolOfRow(r), quantity: Number(r.quantity ?? r.total_quantity), avgPrice: Number(r.average_buy_price) || null })).filter(r => r.quantity > 0);
    },
  };
}
export const robinhoodView = r => ({ state: RH_STATE[String(r.state).toLowerCase()] ?? "unknown", brokerId: r.id ?? null,
  cumQty: Number(r.cumulative_quantity) || 0, avgPrice: Number(r.average_price) || null, fees: Number(r.fees) || 0, filledAt: Date.parse(r.last_transaction_at) || null });

// ks: { get(path), post(path, body) } from src/core/kalshi.mjs connect(). Prices are for the held side.
export function kalshiAdapter(ks, { sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now } = {}) {
  return {
    broker: "kalshi",
    async place(o) {
      if (isCombo(o.instrument) && o.side === "buy") return acceptComboQuote(ks, o, { sleep, now });
      const body = kalshiOrderBody({ ticker: o.instrument, side: o.outcomeSide, count: o.quantity, price: o.limitPrice, sell: o.side === "sell" }, o.clientId);
      try { return kalshiView((await ks.post("/portfolio/events/orders", body)).order ?? {}, o.outcomeSide, o.clientId); }
      catch (error) {
        if (/Kalshi (400|409|422):/.test(String(error.message))) error.rejected = true;
        throw error;
      }
    },
    async lookup(o) {
      if (isCombo(o.instrument) && o.side === "buy") return comboLookup(ks, o, now());
      let cursor = "";
      for (let page = 0; page < MAX_PAGES; page++) {
        const r = await ks.get(`/portfolio/orders?ticker=${encodeURIComponent(o.instrument)}&limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        const hit = (r.orders || []).find(x => x.client_order_id === o.client_id);
        if (hit) return kalshiView(hit, o.outcome_side, o.client_id);
        if (!r.cursor) return null;
        cursor = r.cursor;
      }
      throw Error("Kalshi order pagination incomplete");
    },
    // Settlement records (seen live 2026-11-02): ticker, market_result, yes/no_count_fp, *_total_cost_dollars,
    // revenue in cents, fee_cost, settled_time.
    async settlements() {
      const r = await ks.get("/portfolio/settlements?limit=200");
      return r.settlements || [];
    },
    async positions() {
      const r = await ks.get("/portfolio/positions?count_filter=position");
      return (r.market_positions || []).filter(p => Number(p.position_fp)).map(p => ({ instrument: p.ticker, side: Number(p.position_fp) > 0 ? "yes" : "no", quantity: Math.abs(Number(p.position_fp)) }));
    },
  };
}
// A parlay buy accepts the maker's quote instead of placing an order (o.rfq from the session's live quote). The quote is
// read again first: gone or above the limit is a definitive refusal. Combos are High Volatility Markets: the maker has 3 s
// to confirm and execution follows 1 s later (Kalshi RFQ guide), so a quote not done in COMBO_WAIT_MS is left to reconcile.
const COMBO_WAIT_MS = 15000, COMBO_GIVE_UP_MS = 5 * 60000;
const refused = message => Object.assign(Error(`Kalshi 400: ${message}`), { rejected: true });
async function acceptComboQuote(ks, o, { sleep, now }) {
  if (!o.rfq?.rfqId || !o.rfq?.quoteId) throw refused("no quote to accept for this parlay");
  const path = `/communications/rfqs/${encodeURIComponent(o.rfq.rfqId)}/quotes/${encodeURIComponent(o.rfq.quoteId)}`;
  // Nothing is sent before the accept, so a failed read here is a definite refusal, not an unknown order.
  const { quote } = await ks.get(path).catch(error => { throw refused(`could not read the quote (${String(error.message).slice(0, 100)})`); });
  const cost = comboYesCost(quote);
  if (quote?.status !== "open" || cost == null) throw refused(`the quote is ${quote?.status || "gone"}`);
  if (cost > Number(o.limitPrice) + 1e-9) throw refused(`the quote moved to ${cost}, above the limit ${o.limitPrice}`);
  const started = now(), brokerId = `${o.rfq.rfqId}/${o.rfq.quoteId}`;   // the quote's path, so reconcile can read it again
  try { await ks.put(`${path}/accept`, { accepted_side: "no" }); }   // buying YES accepts the maker's NO side
  catch (error) { if (/Kalshi (400|404|409|422):/.test(String(error.message))) error.rejected = true; throw error; }
  let orderId;   // Richie's order id from the executed quote, the exact key for his fills
  for (let waited = 0; waited < COMBO_WAIT_MS; waited += 1000) {
    await sleep(1000);
    const q = (await ks.get(path).catch(() => ({}))).quote;
    if (q?.status === "cancelled") return { state: "cancelled", brokerId, cumQty: 0, avgPrice: null, fees: 0, clientId: o.clientId, reason: `the maker did not confirm (${q.cancellation_reason || "cancelled"})` };
    if (q?.status === "executed") {
      orderId = q.rfq_creator_order_id ?? orderId;
      const view = await comboFillView(ks, o.instrument, { since: started, at: now(), clientId: o.clientId, orderId, wanted: Number(o.quantity) });
      if (view?.wrongSide) throw Error(view.reason);   // never booked: the order stays unknown and an important alert goes out
      if (view?.state === "filled") return { ...view, brokerId };
    }
  }
  // Executed with only part of the fills listed yet: book what is there and let reconcile collect the rest.
  const seen = await comboFillView(ks, o.instrument, { since: started, at: now(), clientId: o.clientId, orderId, wanted: Number(o.quantity) }).catch(() => null);
  if (seen && !seen.wrongSide && seen.cumQty > 0) return { ...seen, brokerId };
  return { state: "submitted", brokerId, cumQty: 0, avgPrice: null, fees: 0, clientId: o.clientId };
}
// Reconcile: with the quote's path saved as broker_id, its status and Richie's own order id answer it; an order that
// never reached the accept (no broker_id) falls back to fills since it was made.
async function comboLookup(ks, o, at) {
  const [rfqId, quoteId] = String(o.broker_id || "").split("/");
  const q = rfqId && quoteId ? (await ks.get(`/communications/rfqs/${encodeURIComponent(rfqId)}/quotes/${encodeURIComponent(quoteId)}`).catch(() => ({}))).quote : null;
  if (q?.status === "cancelled") return { state: "cancelled", brokerId: null, cumQty: 0, avgPrice: null, fees: 0, clientId: o.client_id, reason: `the maker did not confirm (${q.cancellation_reason || "cancelled"})` };
  const view = await comboFillView(ks, o.instrument, { since: o.created_at, at, clientId: o.client_id, orderId: q?.rfq_creator_order_id, wanted: Number(o.requested_qty) });
  // A wrong-side fill stays unknown with its reason, and only this order does: reconcile goes on for every other bet,
  // and the NO position Kalshi holds shows up as unmatched inventory, an important alert.
  return view?.wrongSide ? { state: "unknown", brokerId: null, cumQty: 0, avgPrice: null, fees: 0, clientId: o.client_id, reason: view.reason } : view;
}
// Richie's YES fills on a combo for this order: by Kalshi's order id for Richie's side when the quote gives it, else every
// YES fill since the order was made (one unresolved buy per instrument is all submitOrder allows). Short of the wanted
// size it is partial; still short, or with nothing, after COMBO_GIVE_UP_MS the rest is not coming. A NO fill on this order
// comes back as wrongSide for the caller to raise.
const CLOCK_SLACK_MS = 5000;
async function comboFillView(ks, ticker, { since, at, clientId, orderId, wanted }) {
  const { fills = [] } = await ks.get(`/portfolio/fills?ticker=${encodeURIComponent(ticker)}&min_ts=${Math.floor((since - CLOCK_SLACK_MS) / 1000)}&limit=200`);
  const sideOf = f => f.outcome_side ?? f.side;
  const wrong = orderId ? fills.filter(f => f.order_id === orderId && sideOf(f) !== "yes") : [];
  if (wrong.length) return { wrongSide: true, reason: `parlay ${ticker} filled on the NO side (${wrong.reduce((s, f) => s + Number(f.count_fp), 0)} contracts, order ${orderId}); check it on Kalshi` };
  const mine = fills.filter(f => sideOf(f) === "yes" && (orderId ? f.order_id === orderId : Date.parse(f.created_time) >= since - CLOCK_SLACK_MS));
  const qty = mine.reduce((s, f) => s + Number(f.count_fp), 0), late = at - since > COMBO_GIVE_UP_MS;
  if (!(qty > 0)) return late ? { state: "cancelled", brokerId: null, cumQty: 0, avgPrice: null, fees: 0, clientId, reason: "no fill on the accepted parlay quote" } : null;
  const full = !(wanted > 0) || qty >= wanted - 1e-6;
  return { state: full ? "filled" : late ? "cancelled" : "partially_filled", brokerId: null, cumQty: qty,
    avgPrice: mine.reduce((s, f) => s + Number(f.count_fp) * Number(f.yes_price_dollars), 0) / qty, fees: mine.reduce((s, f) => s + (Number(f.fee_cost) || 0), 0),
    filledAt: Math.max(...mine.map(f => Date.parse(f.created_time))), clientId, ...(full ? {} : { reason: `${qty} of ${wanted} contracts filled${late ? "; the rest did not come" : ""}` }) };
}

// Kalshi quotes the YES side; a NO holder's price is 1 minus it. An immediate-or-cancel order that filled
// partly ends "canceled" with a fill count above zero: that is a cancelled order with real fills. The fixed-point
// count is read first: counts go to 0.01 contract, and a whole-number field cannot hold 2.64 of them.
export function kalshiView(r, side, clientId) {
  const status = String(r.status || "").toLowerCase();
  const filled = Number(r.fill_count_fp ?? r.fill_count) || 0, yes = Number(r.average_fill_price ?? r.yes_price_dollars);
  const state = status === "executed" ? "filled" : status === "canceled" || status === "cancelled" ? "cancelled" : status === "resting" ? (filled ? "partially_filled" : "submitted") : "unknown";
  const avgPrice = filled && yes > 0 ? (side === "no" ? 1 - yes : yes) : null;
  return { state, brokerId: r.order_id ?? null, cumQty: filled, avgPrice, fees: Number(r.taker_fees_dollars ?? r.fees_dollars) || 0, clientId };
}
