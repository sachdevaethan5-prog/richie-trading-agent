// Live check of the parlay path that moves no money. With Richie's Kalshi key it
// picks two open NFL legs from different games, builds the combo, asks for a 1-contract quote, reads it back exactly as
// the gate and the adapter do, reads the combo market as the monitor does, then deletes the request. It never accepts a
// quote, so nothing can fill.
//   node src/parlay-check.mjs
//
// With --buy it is your own one-contract test trade of the accept and fill: real money (about a dollar). You run it and
// type yes. Stop live Richie (src/live.mjs) first: it takes the execution lease, buys through Richie's own submitOrder
// and Kalshi adapter so the ledger books it, reconciles with Kalshi and hands the lease back.
import { connect } from "./core/kalshi.mjs";
import { LEDGER_FILE } from "./env.mjs";
import { parlayQuote, comboLiveQuote } from "./live-sessions.mjs";
import { parlayProblem } from "./sessions.mjs";
import { comboYesCost, kalshiFee } from "./core/lib.mjs";

const ks = await connect(), own = new Map(), say = (...a) => console.log(...a);
const open = async series => ((await ks.get(`/markets?series_ticker=${series}&status=open&limit=1000`)).markets || [])
  .filter(m => Number(m.yes_ask_dollars) >= 0.3 && Number(m.yes_ask_dollars) <= 0.8).sort((a, b) => Number(b.volume_fp) - Number(a.volume_fp));
const game = m => m.event_ticker.split("-").slice(1).join("-");
let failed = false;
const check = (ok, line) => { say(`${ok ? "ok  " : "FAIL"} ${line}`); if (!ok) failed = true; };
if (process.argv.includes("--buy")) { await testBuy(); process.exit(failed ? 1 : 0); }
const [spread] = await open("KXNFLSPREAD"), total = (await open("KXNFLTOTAL")).find(m => game(m) !== game(spread));
if (!spread || !total) { say("No two open NFL legs in different games right now; nothing to check."); process.exit(0); }
const legs = [{ ticker: spread.ticker, side: "yes" }, { ticker: total.ticker, side: "yes" }];
try {
  say(await parlayQuote(ks, { legs, contracts: 1 }, { own }));
  const [[ticker, mine]] = [...own];
  check(Boolean(mine?.id), `request made on ${ticker}`);
  const { rfq } = await ks.get(`/communications/rfqs/${mine.id}`);
  check(rfq.status === "open" && Number(rfq.contracts_fp) === 1, `request is open for ${rfq.contracts_fp} contracts`);
  check(JSON.stringify(rfq.mve_selected_legs.map(l => [l.market_ticker, l.side]).sort()) === JSON.stringify(legs.map(l => [l.ticker, l.side]).sort()), "request carries exactly the chosen legs");
  const live = await comboLiveQuote(ks, ticker, own);
  say("live quote for the gate:", JSON.stringify(live));
  if (live) {
    const { quote } = await ks.get(`/communications/rfqs/${live.rfqId}/quotes/${live.quoteId}`);
    check(quote.status === "open" && comboYesCost(quote) === live.ask, `the adapter reads the same quote: YES at ${comboYesCost(quote)}, maker bids yes ${quote.yes_bid_dollars} no ${quote.no_bid_dollars}`);
    check(Number(quote.yes_bid_dollars) + Number(quote.no_bid_dollars) <= 1, "the two bids add to $1 or less, so YES costs 1 minus the NO bid");
    check(parlayProblem({ outcomeSide: "yes", quantity: 1, stop: null, target: null }, live) === null, "the parlay gate passes this quote at its size");
  } else say("No maker quoted, so the quote read-back could not be checked this time. Run it again later.");
  const { market } = await ks.get(`/markets/${encodeURIComponent(ticker)}`);
  check(market?.ticker === ticker, `the monitor can read the combo market (status ${market?.status}, yes bid ${market?.yes_bid_dollars})`);
} catch (error) { check(false, `error: ${error.message}`); }
finally {
  for (const [, r] of own) {
    await ks.delete(`/communications/rfqs/${r.id}`).catch(e => say(`could not delete request ${r.id}: ${e.message}`));
    const after = (await ks.get(`/communications/rfqs/${r.id}`).catch(() => ({}))).rfq;
    check(after?.status !== "open", `request ${r.id} deleted (now ${after?.status ?? "gone"})`);
  }
}
say(failed ? "Parlay check FAILED." : "Parlay check passed. No quote was accepted; no money moved.");
process.exit(failed ? 1 : 0);

async function testBuy() {
  const { createInterface } = await import("node:readline/promises");
  const { openLedger } = await import("./ledger.mjs"), { submitOrder, reconcile, EXECUTION_LEASE } = await import("./execution.mjs");
  const { kalshiAdapter } = await import("./adapters/brokers.mjs"), { kalshiReader } = await import("./adapters/readers.mjs");
  const ledger = openLedger(LEDGER_FILE);
  const owner = `parlay-check-${process.pid}`, sleep = ms => new Promise(r => setTimeout(r, ms));

  // Two open NFL legs from different games, quoted at one contract. Nothing is bought before the owner's yes.
  const [spread] = await open("KXNFLSPREAD"), total = (await open("KXNFLTOTAL")).find(m => game(m) !== game(spread));
  if (!spread || !total) return say("No two open NFL legs in different games right now. Nothing was bought.");
  say(await parlayQuote(ks, { legs: [{ ticker: spread.ticker, side: "yes" }, { ticker: total.ticker, side: "yes" }], contracts: 1 }, { own }));
  const [[ticker]] = [...own];
  let live = await comboLiveQuote(ks, ticker, own);
  if (!live) { await cleanup(); return say("No maker quoted. Nothing was bought."); }
  const shown = live.ask;
  say(`\nTEST BUY: 1 contract of YES on ${ticker} at ${shown}, plus a fee of about $${kalshiFee(1, shown).toFixed(2)}: at most $${(shown + kalshiFee(1, shown)).toFixed(2)}.`);
  say("It pays $1 if both legs win, else $0, held to settlement.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("Type yes to buy it: ")).trim().toLowerCase();
  rl.close();
  if (answer !== "yes") { await cleanup(); return say("Not bought."); }

  // Ctrl-C or a kill still hands the lease back.
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => { ledger.release(EXECUTION_LEASE, owner); process.exit(1); });
  try {
    for (let i = 0; i < 3 && !ledger.lease(EXECUTION_LEASE, owner, 120000); i++) await sleep(3000);
    if (!ledger.holds(EXECUTION_LEASE, owner)) throw Error("live Richie holds the execution lease: stop src/live.mjs first; nothing was bought");
    ledger.setAccount(await kalshiReader(ks).account());
    live = await comboLiveQuote(ks, ticker, own);
    if (!live || live.ask > shown + 1e-9) throw Error(`the quote moved from ${shown} to ${live?.ask ?? "none"}; nothing was bought`);
    const adapter = kalshiAdapter(ks);
    const result = await submitOrder({ ledger, adapter, owner, mode: "live", order: { broker: "kalshi", instrument: ticker, instrumentType: "event_contract", side: "buy", outcomeSide: "yes",
      quantity: 1, limitPrice: live.ask, rfq: { rfqId: live.rfqId, quoteId: live.quoteId }, plan: { stop: null, target: null, entry: live.ask, source: "parlay test buy" } } });
    const row = result.clientId ? ledger.order(result.clientId) : null;
    check(result.state === "filled", `order ${result.state}${row?.reason ? `: ${row.reason}` : ""}${result.reason ? `: ${result.reason}` : ""}`);
    const report = await reconcile({ ledger, adapter });
    const booked = ledger.positions("open").find(p => p.instrument === ticker);
    const atKalshi = (await adapter.positions()).find(p => p.instrument === ticker);
    check(booked?.side === "yes" && booked.quantity > 0, `Richie's ledger: ${booked ? `${booked.side.toUpperCase()} ${booked.quantity} at cost $${Number(booked.cost_basis).toFixed(4)}` : "no position"}`);
    check(atKalshi?.side === "yes" && Math.abs(atKalshi.quantity - (booked?.quantity ?? 0)) < 1e-6, `Kalshi: ${atKalshi ? `${atKalshi.side.toUpperCase()} ${atKalshi.quantity}` : "no position"}`);
    check(!report.mismatches.some(m => m.instrument === ticker), "reconcile finds no mismatch for it");
  } catch (error) { check(false, error.message); }
  finally {
    ledger.release(EXECUTION_LEASE, owner);
    await cleanup();
  }
  say(failed ? "Test buy FAILED: read the lines above." : "Test buy passed: Richie's ledger and Kalshi both hold the YES parlay, held to settlement.");
}
async function cleanup() { for (const [, r] of own) await ks.delete(`/communications/rfqs/${r.id}`).catch(() => {}); }
