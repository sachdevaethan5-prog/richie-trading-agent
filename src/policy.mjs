// The redesigned order policy. The owner removed the per-buy share, open-position count,
// daily order count and 30% drawdown pause; none of them is here under any name. What stays is what makes an
// order correct: a known product, a valid size, cash only (cost plus estimated fee never above available cash),
// a fresh balance to size from, pause blocking risk-increasing orders, and exits never larger than the holding.
// Strategy gates (case age, Kalshi edge, chase) belong to a strategy version, not here: see strategy.mjs.
import { FIXED, SETTINGS } from "./config.mjs";
import { freshness } from "./health.mjs";
import { kalshiFee } from "./core/lib.mjs";

export const estimatedFee = o => o.broker === "kalshi" ? kalshiFee(o.quantity, o.limitPrice) : 0;   // Robinhood equities/crypto: no commission
export const orderCost = o => (Number.isFinite(o.notional) ? o.notional : o.quantity * o.limitPrice) + estimatedFee(o);

// order: { broker, instrument, instrumentType, side, quantity?, limitPrice?, notional? }
// account: the ledger row for that broker. held: the open position row, if any.
export function orderProblem(order, { account, held, paused, now = Date.now() }) {
  if (!["buy", "sell"].includes(order.side)) return "Side must be buy or sell.";
  if (!FIXED.products[order.broker]?.includes(order.instrumentType)) return `${order.instrumentType || "That product"} on ${order.broker || "an unknown broker"} is outside Richie's approved scope.`;
  const qty = Number(order.quantity), price = Number(order.limitPrice), notional = Number(order.notional);
  const sized = (qty > 0 && price > 0) || notional > 0;
  if (!sized) return "The order needs a positive quantity and limit price, or a dollar amount.";
  // Kalshi counts are fixed point: "the minimum granularity is 0.01 contracts" (FixedPointCount, Kalshi OpenAPI 3.35.0),
  // and fills can be fractional (2026-11-02: 3.36 of 6 sold, 2.64 left, which a whole-count rule then could not sell).
  const onCentGrid = Math.abs(qty * 100 - Math.round(qty * 100)) < 1e-6;
  if (order.broker === "kalshi" && !(price >= 0.01 && price <= 0.99 && onCentGrid)) return "A Kalshi order needs a count in steps of 0.01 contract and a price from 0.01 to 0.99.";
  if (order.side === "sell") {
    // An exit is always allowed (pause included), but only out of what is actually held.
    if (!held || !(held.quantity > 0)) return `No booked ${order.instrument} position to sell.`;
    if (qty > held.quantity + 1e-9) return `Sell quantity ${qty} is more than the ${held.quantity} held.`;
    return null;
  }
  if (paused) return "Paused: no risk-increasing orders. Exits still run.";
  const state = freshness({ asOf: account?.as_of, lastErrorAt: account?.last_error_at, sample: Boolean(account?.sample) }, SETTINGS.freshness.accountMs, now);
  if (state !== "live") return `The ${order.broker} balance is ${state}, so the order cannot be sized. Read the account first.`;
  if (!Number.isFinite(account.cash)) return "Available cash is unknown.";
  const cost = orderCost(order);
  if (cost > account.cash + 1e-9) return `That costs $${cost.toFixed(2)} with fees; only $${account.cash.toFixed(2)} cash is available. Richie never borrows.`;
  return null;
}
