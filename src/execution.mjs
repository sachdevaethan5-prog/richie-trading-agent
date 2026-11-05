// The one place an order can cross to a broker.
// Order of operations: observation mode check, execution lease, unresolved earlier order, policy, durable
// intent with a client id, pause re-check, then the adapter. An unknown outcome is kept unknown and blocks a
// repeat until reconcile() reads the broker's record. Nothing here retries an order.
import { randomUUID } from "node:crypto";
import { EXECUTION_MODE } from "./config.mjs";
import { orderProblem, orderCost } from "./policy.mjs";
import { positionId } from "./ledger.mjs";
import { errorClass } from "./health.mjs";

export const EXECUTION_LEASE = "execution";
// Down to the cent, past a float slip (8 - 5.9 is 2.0999...).
export const cents = x => Math.floor(x * 100 + 1e-6) / 100;

export async function submitOrder({ ledger, adapter, order, mode = EXECUTION_MODE, owner, paused = async () => false, now = Date.now, newId = randomUUID }) {
  // Fails closed: anything other than the exact string "live" is observation.
  if (mode !== "live") return { state: "blocked", reason: "Observation mode: order submission is disabled.", wouldSubmit: order };
  if (!owner || !ledger.holds(EXECUTION_LEASE, owner, now())) return { state: "blocked", reason: "This process does not hold the execution lease; another owner may be trading." };
  // Read before the checks: from the unresolved-order check to the durable intent nothing may await, or two lanes
  // (a stop exit and a session sale) could both pass the check and both reach the broker.
  const isPaused = await paused();
  const earlier = ledger.pendingFor(order.broker, order.instrument, order.side);
  if (earlier) return { state: "blocked", reason: `An earlier ${order.side} for ${order.instrument} is ${earlier.state} and not reconciled. No second order.`, clientId: earlier.client_id };
  const held = ledger.position(positionId(order.broker, order.instrument, order.outcomeSide || "long"));
  const problem = orderProblem(order, { account: unspentAccount(ledger, order), held, paused: isPaused, now: now() });
  if (problem) return { state: "blocked", reason: problem };
  const clientId = newId();
  ledger.tx(() => ledger.recordIntent({ ...order, clientId }, now()));   // a storage failure throws here, before any broker call
  if (order.side === "buy" && await paused()) {
    ledger.setOrderState(clientId, "blocked", { reason: "Paused before submission; nothing was sent." }, now());
    return { state: "blocked", reason: "Paused before submission; nothing was sent.", clientId };
  }
  let result;
  try { result = await adapter.place({ ...order, clientId }); }
  catch (error) {
    // Only an explicit broker refusal is definitive. A timeout or dropped connection may have been accepted.
    const state = error.rejected ? "rejected" : "unknown";
    ledger.setOrderState(clientId, state, { reason: `${errorClass(error)}: ${String(error.message).slice(0, 160)}` }, now());
    if (state === "unknown") ledger.alert({ kind: "order_unknown", severity: "important", subject: order.instrument, at: now(), dedupe: `order_unknown:${clientId}`,
      text: `The ${order.instrument} ${order.side} may or may not have reached ${order.broker} (${errorClass(error)}). No resend until the broker record is read.` });
    return { state, clientId, error: errorClass(error) };
  }
  applyBrokerView(ledger, clientId, result, now());
  return { state: ledger.order(clientId).state, clientId };
}

// The broker's cash less what buys sent since that reading may have spent. The balance is read every 2 minutes, so a
// second buy in the same session saw the cash the first one had already used (the Robinhood account is limited
// margin, where that could borrow). A refused or blocked buy spent nothing; a finished one spent its fills; one still
// open or unknown counts at the larger of its fills and its requested cost.
export function unspentAccount(ledger, order) {
  const account = ledger.account(order.broker);
  if (order.side !== "buy" || !account || !Number.isFinite(account.cash) || !Number.isFinite(account.as_of)) return account;
  let spent = 0;
  for (const o of ledger.all("SELECT * FROM orders WHERE broker = ? AND side = 'buy' AND created_at >= ? AND state NOT IN ('rejected', 'blocked')", order.broker, account.as_of)) {
    const filled = ledger.fillsFor(o.client_id).reduce((s, f) => s + f.qty * f.price + f.fee, 0);
    const asked = { broker: o.broker, quantity: o.requested_qty, limitPrice: o.limit_price, notional: o.notional ?? undefined };
    const requested = Number.isFinite(o.notional) || (o.requested_qty > 0 && o.limit_price > 0) ? orderCost(asked) : 0;
    spent += ["filled", "cancelled"].includes(o.state) ? filled : Math.max(filled, requested);
  }
  return spent > 0 ? { ...account, cash: account.cash - spent } : account;
}

// Applies what the broker reports for one order: its state and any fills. Cumulative reports (Robinhood gives
// cumulative quantity and average price, not per-fill rows) are booked as the difference from what is booked, at the
// broker's last transaction time when it gives one (a fill found later by reconcile keeps its real time).
export function applyBrokerView(ledger, clientId, view, at) {
  ledger.tx(() => {
    const o = ledger.order(clientId);
    const fills = [...(view.fills || [])];
    if (!fills.length && view.cumQty > o.filled_qty + 1e-12 && view.avgPrice > 0) {
      const booked = ledger.fillsFor(clientId), bookedQty = booked.reduce((s, f) => s + f.qty, 0), bookedCost = booked.reduce((s, f) => s + f.qty * f.price, 0);
      const qty = view.cumQty - bookedQty, bookedFees = booked.reduce((s, f) => s + f.fee, 0);
      if (qty > 1e-12) fills.push({ fillKey: `${clientId}:cum:${view.cumQty}`, qty, price: (view.cumQty * view.avgPrice - bookedCost) / qty, fee: Math.max(0, (view.fees || 0) - bookedFees), at: view.filledAt ?? at });
    }
    for (const f of fills) ledger.applyFill({ clientId, fillKey: f.fillKey, qty: f.qty, price: f.price, fee: f.fee || 0, at: f.at ?? at });
    const filledQty = ledger.fillsFor(clientId).reduce((s, f) => s + f.qty, 0);
    if (view.state && view.state !== o.state) ledger.setOrderState(clientId, view.state, { brokerId: view.brokerId, filledQty, avgPrice: view.avgPrice, fees: view.fees, reason: view.reason }, at);
    else ledger.setOrderState(clientId, o.state, { filledQty }, at);
  });
}

// Startup and periodic reconciliation for one broker. Reads every unresolved order and the broker's positions.
// Unmatched inventory and missing positions become alerts; nothing is closed or invented to make them agree.
export async function reconcile({ ledger, adapter, now = Date.now }) {
  const broker = adapter.broker, report = { resolved: [], stillUnknown: [], mismatches: [] };
  try {
    for (const o of ledger.openOrders().filter(o => o.broker === broker)) {
      const claimed = new Set(ledger.all("SELECT broker_id FROM orders WHERE broker = ? AND broker_id IS NOT NULL AND client_id != ?", broker, o.client_id).map(r => r.broker_id));
      const view = await adapter.lookup(o, { claimed });   // throws when the broker's order list could not be read completely
      if (!view) {
        if (o.state === "intent" || o.state === "unknown") {
          if (o.state === "intent") ledger.setOrderState(o.client_id, "unknown", { reason: "Not found at the broker yet" }, now());
          report.stillUnknown.push(o.client_id);
        }
        continue;
      }
      applyBrokerView(ledger, o.client_id, view, now());
      if (ledger.order(o.client_id).state !== "unknown") { ledger.resolveAlert(`order_unknown:${o.client_id}`, now()); report.resolved.push(o.client_id); }
    }
    const brokerPositions = await adapter.positions();
    const booked = ledger.positions("open").filter(p => p.broker === broker);
    for (const bp of brokerPositions) {
      const p = booked.find(x => x.instrument === bp.instrument && (x.side === (bp.side || "long")));
      if (!p) report.mismatches.push({ kind: "unmatched_inventory", instrument: bp.instrument, broker: bp.quantity });
      // A legacy import with no recorded quantity (legacy state kept dollars, not shares) takes the broker's count
      // once, and the broker's own average cost when it reports one; without that the basis stays estimated.
      // Nothing else is ever overwritten to make the two agree.
      else if (!(p.quantity > 0) && p.basis_status !== "confirmed") {
        const cost = bp.avgPrice > 0 ? bp.quantity * bp.avgPrice : null;
        ledger.run("UPDATE positions SET quantity = ?, cost_basis = COALESCE(?, cost_basis), basis_status = ? WHERE id = ?", bp.quantity, cost, cost != null ? "confirmed" : p.basis_status, p.id);
        ledger.alert({ kind: "quantity_adopted", severity: "info", subject: bp.instrument, at: now(), dedupe: `quantity_adopted:${p.id}`,
          text: `${bp.instrument}: quantity ${bp.quantity} taken from ${broker}; the import had none. ${cost != null ? `Cost basis from ${broker}'s average price.` : "Cost basis is still an estimate."}` });
        if (cost != null) ledger.resolveAlert(`quantity_adopted:${p.id}`, now());   // a record, not something to act on
        report.adopted = [...(report.adopted || []), bp.instrument];
      }
      else if (Math.abs(p.quantity - bp.quantity) > 1e-6) report.mismatches.push({ kind: "quantity_mismatch", instrument: bp.instrument, broker: bp.quantity, ledger: p.quantity });
    }
    // A Kalshi position gone because its market settled is booked at the payout, not reported missing.
    const gone = booked.filter(p => !brokerPositions.some(bp => bp.instrument === p.instrument && (bp.side || "long") === p.side));
    const settled = gone.length && adapter.settlements ? await adapter.settlements() : [];
    for (const p of gone) {
      const st = settled.find(x => x.ticker === p.instrument);
      if (!st) { report.mismatches.push({ kind: "missing_at_broker", instrument: p.instrument, ledger: p.quantity }); continue; }
      const at = Date.parse(st.settled_time) || now(), won = st.market_result === p.side;
      const out = ledger.settlePosition(p.id, { payout: Number(st.revenue) / 100, result: st.market_result, at });
      if (!out) continue;
      report.settled = [...(report.settled || []), p.instrument];
      ledger.alert({ kind: "settled", severity: "important", subject: p.instrument, at, dedupe: `settled:${p.id}:${st.settled_time}`,
        text: `Settled: ${p.instrument} resolved ${String(st.market_result).toUpperCase()}, so the ${String(p.side).toUpperCase()} side ${won ? "won" : "lost"}. Paid $${out.payout.toFixed(2)}${out.pnl == null ? "" : `, ${out.pnl >= 0 ? "a gain" : "a loss"} of $${Math.abs(out.pnl).toFixed(2)}`}.` });
      ledger.event({ at, kind: "settlement", broker, subject: p.instrument, text: `${p.instrument} settled ${st.market_result}: paid $${out.payout.toFixed(2)}.`, dedupe: `settlement:${p.id}` });
    }
    for (const m of report.mismatches) ledger.alert({ kind: m.kind, severity: "important", subject: m.instrument, at: now(), dedupe: `${m.kind}:${broker}:${m.instrument}`,
      text: m.kind === "unmatched_inventory" ? `${broker} holds ${m.broker} ${m.instrument} that Richie's ledger does not. Basis and protection unknown.`
        : m.kind === "missing_at_broker" ? `Ledger shows ${m.ledger} ${m.instrument} but ${broker} reports none. Not marked closed until a fill or settlement explains it.`
        : `${m.instrument}: ${broker} reports ${m.broker}, ledger ${m.ledger}. Reconcile before trading it.` });
    // A mismatch the broker and ledger now agree on (a fill booked, a count corrected) is no longer open.
    const current = new Set(report.mismatches.map(m => `${m.kind}:${broker}:${m.instrument}`));
    for (const a of ledger.alerts().filter(a => ["missing_at_broker", "unmatched_inventory", "quantity_mismatch"].includes(a.kind) && a.dedupe?.startsWith(`${a.kind}:${broker}:`)))
      if (!current.has(a.dedupe)) ledger.resolveAlert(a.dedupe, now());
    ledger.healthOk(`broker_sync:${broker}`, now());
  } catch (error) {
    ledger.healthError(`broker_sync:${broker}`, errorClass(error), now(), String(error.message).slice(0, 160));
    throw error;
  }
  return report;
}
