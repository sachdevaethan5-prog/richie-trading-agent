// Fixture ledger for the offline dashboard demo and tests. Every number here is illustrative, not an account
// reading. Rows are flagged sample except where a row exists to show a non-sample state (a stale quote, a
// missing quote, a degraded component); the snapshot itself is always flagged sample, and the dashboard says so.
// It is built through the real ledger, execution, monitor and research code so the demo exercises them.
import { openLedger, positionId } from "../ledger.mjs";
import { applyBrokerView } from "../execution.mjs";
import { monitorTick } from "../monitor.mjs";
import { dispatch, fixtureProvider } from "../research.mjs";
import { evaluate, buyAndHold, evaluationReport, LEGACY_GATES } from "../strategy.mjs";
import { orderMessage } from "../voice.mjs";

const M = 60000, H = 3600000;

export async function demoLedger(now = Date.now()) {
  const L = openLedger(":memory:");
  L.meta("sample", 1);
  L.setAccount({ broker: "robinhood", accountRef: "SAMPLE0001", cash: 4.8, buyingPower: 4.8, value: 10.21, source: "fixture", asOf: now - 2 * M, sample: true });
  L.setAccount({ broker: "kalshi", cash: 3.62, value: 10.1, source: "fixture", asOf: now - 3 * M, sample: true });

  const order = (o, view, at) => {
    L.recordIntent({ sample: true, ...o }, at);
    if (view) applyBrokerView(L, o.clientId, view, at);
    return L.order(o.clientId);
  };
  // ABBV: a complete fill, watched by Richie's process.
  order({ clientId: "fx-abbv-1", broker: "robinhood", instrument: "ABBV", instrumentType: "stock", side: "buy", notional: 4, evidenceId: "ev-abbv", plan: { stop: 266.5, target: 301, horizon: "intraday to 3 sessions" } },
    { state: "filled", brokerId: "rh-sample-1", cumQty: 0.0141, avgPrice: 283.67, fees: 0 }, now - 5 * H);
  // XLE: partially filled, the rest still working.
  order({ clientId: "fx-xle-1", broker: "robinhood", instrument: "XLE", instrumentType: "etf", side: "buy", quantity: 0.065, limitPrice: 63.1, evidenceId: "ev-xle", plan: { stop: 61.8, target: 67.2 } },
    { state: "partially_filled", brokerId: "rh-sample-2", cumQty: 0.04, avgPrice: 63.05, fees: 0 }, now - 50 * M);
  // Kalshi YES contracts: IOC order that filled 2 of 3, then the rest cancelled.
  order({ clientId: "fx-rain-1", broker: "kalshi", instrument: "KXRAINNYC-26OCT28-T0.10", instrumentType: "event_contract", side: "buy", outcomeSide: "yes", quantity: 3, limitPrice: 0.62,
    evidenceId: "ev-rain", plan: { stop: 0.48, target: 0.78, resolution: "NWS Central Park daily precipitation, Oct 28" } },
    { state: "cancelled", brokerId: "ks-sample-1", cumQty: 2, avgPrice: 0.62, fees: 0.04 }, now - 9 * H);
  L.run("UPDATE positions SET name = ?, resolution_at = ? WHERE id = ?", "NYC rain above 0.10 in, Oct 28", now + 30 * H, positionId("kalshi", "KXRAINNYC-26OCT28-T0.10", "yes"));
  L.run("UPDATE positions SET name = 'AbbVie Inc.' WHERE instrument = 'ABBV'");
  L.run("UPDATE positions SET name = 'Energy Select Sector SPDR' WHERE instrument = 'XLE'");
  // ETH imported from the legacy state: basis estimated, quote missing.
  L.run(`INSERT INTO positions (id, broker, instrument, instrument_type, name, quantity, cost_basis, basis_status, opened_at, plan, protection_mode, protection_interval_ms, sample)
    VALUES (?, 'robinhood', 'ETH', 'crypto', 'Ethereum', 0.0009, 2.1, 'estimated', ?, ?, 'richie_watcher', ?, 1)`, positionId("robinhood", "ETH"), now - 3 * 24 * H, JSON.stringify({ stop: 2150, target: 2600, source: "legacy case" }), 2 * M);
  // Orders that never became positions: one unknown, one rejected.
  order({ clientId: "fx-spy-1", broker: "robinhood", instrument: "SPY", instrumentType: "etf", side: "buy", notional: 2 }, null, now - 25 * M);
  L.setOrderState("fx-spy-1", "unknown", { reason: "timeout: no response after sending" }, now - 25 * M);
  L.alert({ kind: "order_unknown", severity: "important", subject: "SPY", at: now - 25 * M, dedupe: "order_unknown:fx-spy-1", text: "The SPY buy may or may not have reached robinhood (timeout). No resend until the broker record is read." });
  order({ clientId: "fx-qqq-1", broker: "robinhood", instrument: "QQQ", instrumentType: "etf", side: "buy", quantity: 0.01, limitPrice: 480 }, { state: "rejected", reason: "validation: market closed for limit orders" }, now - 26 * H);

  // Quotes: ABBV and the Kalshi market current (sample); XLE stale on purpose; ETH has no quote at all.
  const quotes = async () => [
    { broker: "robinhood", instrument: "ABBV", price: 289.34, bid: 289.3, ask: 289.38, source: "fixture", asOf: now - 20 * 1000, sample: true },
    { broker: "robinhood", instrument: "XLE", price: 63.82, bid: 63.8, ask: 63.84, source: "Robinhood quote (fixture)", asOf: now - 9 * M },
    { broker: "kalshi", instrument: "KXRAINNYC-26OCT28-T0.10", price: 0.64, bid: 0.63, ask: 0.65, source: "fixture", asOf: now - 40 * 1000, sample: true,
      depth: { yesBids: [[0.63, 60], [0.62, 31], [0.6, 14]], noBids: [[0.35, 22], [0.34, 40]] } },
  ];
  for (const p of L.positions()) L.setProtection(p.id, { intervalMs: p.instrument_type === "crypto" ? 2 * M : M });
  await monitorTick({ ledger: L, quotes, now: () => now });

  L.healthOk("broker_sync:kalshi", now - 3 * M);
  L.healthError("broker_sync:robinhood", "auth", now - 4 * M, "client id not allowed: <missing>; authenticated read not yet confirmed");
  L.healthOk("telegram_send", now - 50 * M);
  L.healthError("telegram_receive", "network", now - 90 * 1000, "updates may be delayed");
  L.alert({ kind: "auth", severity: "important", subject: "Robinhood", at: now - 4 * M, dedupe: "auth:robinhood", text: "Robinhood refused the client id. Robinhood monitoring is degraded until an authenticated read succeeds." });
  for (const [name, priority, ms] of [["monitor", 0, M], ["reconcile:robinhood", 1, 5 * M], ["reconcile:kalshi", 1, 5 * M], ["research", 5, 30 * M]]) {
    L.defineJob(name, priority, ms);
    L.run("UPDATE jobs SET last_started_at = ?, last_ok_at = ?, runs = 12 WHERE name = ?", now - 40 * 1000, now - 38 * 1000, name);
  }

  // Research packets through the real dispatcher with the fixture provider.
  const item = (source, fact, observedAt, unknowns = []) => ({ source, fact, observedAt, publishedAt: observedAt, unknowns });
  const packets = {
    "ev-abbv": { packet: { recommendation: "supports", question: "Is the ABBV breakout intact into today's close?", items: [
      item("https://example.com/fixture/abbv-bars", "Sample: price held above the prior breakout area on rising volume.", now - 70 * M),
      item("https://example.com/fixture/abbv-earnings", "Sample: next earnings date is after the planned holding window.", now - 3 * H, ["exact report time not confirmed"])],
      countercase: "Biotech policy or trial headlines can gap the price through the stop.", assumptions: ["Spread stays under the screen limit"], risks: ["Gap risk"], wouldChange: "A close back under the breakout level." } },
    "ev-rain-rules": { packet: { recommendation: "supports", question: "What exactly settles this market?", items: [
      item("https://example.com/fixture/kalshi-rules", "Sample: settles on the NWS Central Park daily total for Oct 28, in inches.", now - 9 * H, [])],
      countercase: "A report correction after settlement time.", assumptions: ["Station is Central Park"], risks: [] } },
    "ev-rain": { packet: { recommendation: "supports", question: "Is rain above 0.10 in more likely than the market implies?", items: [
      item("https://example.com/fixture/nws-forecast", "Sample: forecast calls for 0.15 to 0.30 in.", now - 18 * M, ["timing of the front"])],
      countercase: "The front may arrive after midnight and miss the window.", assumptions: ["Forecast skill at 30 hours"], risks: ["Thin book"], estimates: { fair: 0.71, feePerContract: 0.02 } } },
    "ev-msft": { packet: { recommendation: "supports", question: "Does the MSFT setup clear the screen?", items: [
      item("https://example.com/fixture/msft", "Sample: setup looked fine two days ago.", now - 50 * H, [])], countercase: "Range-bound tape.", assumptions: [] } },
  };
  const tasks = [
    { id: "ev-abbv", subject: "ABBV", role: "catalyst and price context", question: packets["ev-abbv"].packet.question, validityMs: 4 * H },
    { id: "ev-rain-rules", subject: "KXRAINNYC-26OCT28-T0.10", role: "resolution rules", question: packets["ev-rain-rules"].packet.question, validityMs: 48 * H },
    { id: "ev-rain", subject: "KXRAINNYC-26OCT28-T0.10", role: "event evidence and fair probability", question: packets["ev-rain"].packet.question, validityMs: 2 * H },
  ];
  const done = [...await dispatch(tasks, { provider: fixtureProvider(packets), now: () => now, strategyVersion: "intraday-proposal-0" }),
    ...await dispatch([{ id: "ev-msft", subject: "MSFT", role: "setup check", question: packets["ev-msft"].packet.question, validityMs: 4 * H }], { provider: fixtureProvider(packets), now: () => now })];
  for (const d of done) L.saveEvidence({ id: d.id, subject: d.subject, role: d.role, verdict: d.packet?.recommendation ?? null, status: d.status, packet: { ...d.packet, problems: d.problems },
    strategyVersion: "intraday-proposal-0", createdAt: now - 30 * M, expiresAt: d.status === "complete" ? now + d.validityMs : now - M, sample: true });
  L.saveEvidence({ id: "ev-xle", subject: "XLE", role: "sector trend", verdict: null, status: "incomplete", packet: { question: "Is the energy trend intact?", items: [], problems: ["research delegation is disabled: no packet"] },
    createdAt: now - 60 * M, sample: true });

  // Candles for ABBV only (daily, fixture). No forecast is stored, so the drawer says "No current forecast".
  const candles = Array.from({ length: 20 }, (_, i) => { const c = 270 + i * 1.0 + Math.sin(i / 2) * 3; return { t: now - (20 - i) * 24 * H, o: c - 1, h: c + 2, l: c - 2.5, c }; });
  L.meta(`candles:${positionId("robinhood", "ABBV")}`, JSON.stringify({ interval: "1d", source: "fixture", asOf: now - 24 * H, sample: true, bars: candles }));

  L.notificationResult(L.notification("order", orderMessage(L.order("fx-abbv-1")), now - 5 * H), { status: "delivered", attempts: 1, detail: "message 1001", at: now - 5 * H });
  L.notificationResult(L.notification("order", orderMessage(L.order("fx-xle-1")), now - 50 * M), { status: "failed", attempts: 4, errorClass: "network", detail: "fetch failed", at: now - 48 * M });
  L.notificationResult(L.notification("alert", "XLE quote is 9 minutes old, so its exit is not being checked against a current price. Checking the feed now.", now - M), { status: "delivered", attempts: 1, at: now - M });

  for (const t of [["robinhood", "SPY", 574.2, 571.1, "target"], ["robinhood", "XOM", 112.4, 108.9, "stop"], ["kalshi", "KXHIGHNY-26OCT21-B70", 0.41, 1, "won"], ["kalshi", "KXCPI-26OCT-T0.3", 0.55, 0, "lost"]])
    L.addTrade({ broker: t[0], instrument: t[1], entry: t[2], exit: t[3], ret: t[3] / t[2] - 1, why: t[4], closedAt: now - 4 * 24 * H, basisStatus: "confirmed", source: "fixture" });
  L.addTrade({ broker: "robinhood", instrument: "NVDA", entry: 131.2, exit: 136.5, ret: 136.5 / 131.2 - 1, why: "target", closedAt: now - 2 * 24 * H, paper: true, source: "fixture" });

  // Strategy summary from a fixture evaluation (illustrative bars, not market history).
  const bars = Array.from({ length: 240 }, (_, i) => { const c = 100 + 8 * Math.sin(i / 17) + i * 0.03; return { t: i, o: c, h: c + 0.6, l: c - 0.6, c: c + 0.1, v: 1000 }; });
  const signal = (seen, i) => i > 20 && seen[i].c > seen[i - 20].c * 1.02 ? { stop: seen[i].c * 0.985, target: seen[i].c * 1.03, maxBars: 12 } : null;
  const result = evaluate(bars, signal, { costs: { slippage: 0.0005, spread: 0.001 } });
  const strategy = { version: "intraday-proposal-0", status: "proposal, not live", sample: true,
    rules: ["Size from the available cash the broker reports; cash only.", "Trade only a setup that clears the version's entry, exit and evidence checks; stay in cash otherwise.",
      "Check open exposure and pending orders before new candidates.", "Exit on stop, target, time limit or a broken thesis.", "Report live and paper results apart, after fees, against a benchmark."],
    legacyGates: Object.entries(LEGACY_GATES).filter(([k]) => k !== "version").map(([k, g]) => ({ name: k, value: g.value, why: g.why })),
    evaluation: { label: "Fixture evaluation on illustrative bars", count: result.count, netReturn: result.netReturn, maxDrawdown: result.maxDrawdown, exposure: result.exposure, winRate: result.winRate,
      sampleNote: result.sampleNote, benchmark: buyAndHold(bars), report: evaluationReport({ version: "intraday-proposal-0", live: null, paper: result, benchmark: buyAndHold(bars) }) },
    openDecisions: ["Model spend and latency budget", "Which trades need DeepSeek and Codex review", "Automatic promotion or the owner's approval", "Monitoring cadence per product", "Private remote access", "Any control beyond read-only"],
    aim: "5 to 10% a month: an aim to measure against, not a promise." };
  return { ledger: L, strategy };
}
