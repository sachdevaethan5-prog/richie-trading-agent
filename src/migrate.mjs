// Import of the legacy state. The legacy state.json is read, never written. Every raw value is
// kept in legacy_import; positions come in with their basis marked confirmed only when the legacy record had a
// broker quantity and cost, and "estimated" or "missing" otherwise. Legacy pending orders come in as "unknown",
// so they block repeats until reconcile() reads the broker record.
// Field names are those richie.mjs, broker-state.mjs and lib.mjs write (state.held, pendingOrders, trades,
// paperDone, kalshi.held, kalshi.trades). A dry run against the real file is a cutover step for the owner's review.
import { positionId } from "./ledger.mjs";

export function importLegacy(ledger, legacy, { now = Date.now(), source = "state.json" } = {}) {
  const report = { positions: [], orders: [], trades: 0, paper: 0, notes: [] };
  ledger.tx(() => {
    ledger.run("INSERT INTO legacy_import (source, raw, imported_at) VALUES (?, ?, ?)", source, JSON.stringify(legacy), now);
    for (const [sym, h] of Object.entries(legacy.held || {})) {
      const type = h.kind === "crypto" ? "crypto" : h.kind === "etf" ? "etf" : "stock";
      const quantity = Number(h.quantity), dollars = Number(h.dollars);
      const basis = h.basisEstimated ? "estimated" : quantity > 0 && dollars > 0 ? "confirmed" : dollars > 0 ? "estimated" : "missing";
      if (!(quantity > 0)) report.notes.push(`${sym}: no recorded quantity; reconcile will read it from Robinhood.`);
      addPosition(ledger, { broker: "robinhood", instrument: sym, type, side: "long", quantity: quantity > 0 ? quantity : 0, cost: dollars > 0 ? dollars : null, basis,
        openedAt: h.at, plan: { stop: h.stop, target: h.target, entry: h.entry, source: "legacy case" } });
      report.positions.push({ id: positionId("robinhood", sym), basis });
    }
    for (const [ticker, h] of Object.entries(legacy.kalshi?.held || {})) {
      const dollars = Number(h.dollars), entry = Number(h.entry);
      // Legacy Kalshi records keep dollars and entry, not a count; the count is only an estimate until reconcile.
      const count = dollars > 0 && entry > 0 ? Math.floor(dollars / entry + 1e-9) : 0;   // 1.20 / 0.40 is 2.9999999999999996 in floating point
      addPosition(ledger, { broker: "kalshi", instrument: ticker, type: "event_contract", side: h.side, quantity: count, cost: dollars > 0 ? dollars : null,
        basis: dollars > 0 ? "estimated" : "missing", openedAt: h.at, plan: { stop: h.stop ?? null, target: h.target ?? null, entry, source: "legacy case" } });
      report.positions.push({ id: positionId("kalshi", ticker, h.side), basis: dollars > 0 ? "estimated" : "missing" });
      report.notes.push(`${ticker}: contract count estimated from dollars and entry; reconcile will replace it.`);
    }
    for (const [ref, p] of Object.entries(legacy.pendingOrders || {})) {
      ledger.recordIntent({ clientId: ref, broker: "robinhood", instrument: p.symbol, instrumentType: p.crypto ? "crypto" : "stock", side: p.side }, Number(p.at) || now);
      ledger.setOrderState(ref, "unknown", { reason: `legacy ${p.status || "pending"} order, not yet reconciled` }, now);
      report.orders.push(ref);
    }
    const trade = (broker, t, paper) => ledger.addTrade({ broker, instrument: t.sym, entry: t.entry, exit: Number.isFinite(t.exit) ? t.exit : null, ret: Number.isFinite(t.ret) ? t.ret : null,
      dollars: t.dollars ?? null, why: t.why, openedAt: t.opened, closedAt: t.closed, paper, basisStatus: t.dollars ? "legacy" : "missing", source });
    for (const t of legacy.trades || []) { trade("robinhood", t, false); report.trades++; }
    for (const t of legacy.kalshi?.trades || []) { trade("kalshi", t, false); report.trades++; }
    for (const t of legacy.paperDone || []) { trade("robinhood", t, true); report.paper++; }
  });
  return report;
}

function addPosition(ledger, p) {
  ledger.run(`INSERT INTO positions (id, broker, instrument, instrument_type, side, quantity, cost_basis, basis_status, opened_at, status, plan, protection_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`, positionId(p.broker, p.instrument, p.side), p.broker, p.instrument, p.type, p.side, p.quantity, p.cost, p.basis,
    p.openedAt ?? null, JSON.stringify(p.plan), Number.isFinite(Number(p.plan.stop)) && p.plan.stop !== null ? "richie_watcher" : "none");
}
