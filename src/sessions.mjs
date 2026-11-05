// Trading sessions and chat for the rebuild. A session is a model with look-only
// tools and one action, propose_trade. A proposal goes through, in order: the legacy case gates (kept by the owner,
// 2026-11-02, until evaluation changes them), the DeepSeek review (the only second opinion now; exits need none),
// then submitOrder(), which applies the order policy and in observation mode only previews. The model never
// reaches an order function itself. Chat has the same look-only tools and no trade action.
import { randomUUID } from "node:crypto";
import { EXECUTION_MODE, DECIDED } from "./config.mjs";
import { sessionPrompt, chatPrompt } from "./prompts.mjs";
import { submitOrder } from "./execution.mjs";
import { orderProblem, estimatedFee } from "./policy.mjs";
import { brier } from "./strategy.mjs";
import { positionId } from "./ledger.mjs";
import { marketOpen } from "./hours.mjs";
import { caseProblem, kalshiCaseProblem, entryOffProblem, kalshiPriceOffProblem, isCombo } from "./core/lib.mjs";

const MAX_STEPS = 24;   // the noon Kalshi session on 2026-11-02 used all of 12 and ended with no summary
const money = n => Number.isFinite(n) ? `$${n.toFixed(2)}` : "unknown";

export const PROPOSE_TRADE = { name: "propose_trade", description: "Propose one trade with its case. Code checks the case against the live price, a reviewer checks the reasoning, and the order rules decide; you get the result. Prices in dollars (Kalshi: dollars per contract of your side).",
  parameters: { type: "object", additionalProperties: false, required: ["instrument", "side", "thesis", "invalidation", "sources"], properties: {
    instrument: { type: "string", description: "Ticker, crypto symbol, or Kalshi market ticker" }, instrumentType: { type: "string", enum: ["stock", "etf", "crypto", "event_contract"] },
    side: { type: "string", enum: ["buy", "sell"] }, outcomeSide: { type: "string", enum: ["yes", "no"], description: "Kalshi only" },
    role: { type: "string", enum: ["satellite", "core"], description: "satellite: a momentum trade (the default). core is refused: idle cash stays in cash" },
    quantity: { type: "number", description: "Shares, coins, or Kalshi contracts (Kalshi in steps of 0.01)" }, limitPrice: { type: "number" }, notional: { type: "number", description: "Dollar amount instead of quantity and limit (Robinhood only)" },
    entry: { type: "number" }, stop: { type: "number" }, target: { type: "number" }, fair: { type: "number", description: "Kalshi: your chance your side wins, 0 to 1" },
    thesis: { type: "string" }, invalidation: { type: "string" }, resolves: { type: "string", description: "Kalshi: when and how it settles" },
    catalyst: { type: "string" }, trend_30d: { type: "string" }, sources: { type: "array", items: { type: "string" } } } } };

// The kept legacy gates, in code before any model sees the case. live: { price, ask } for the proposal's side.
export function gateProblem(p, live) {
  if (p.side === "sell") return null;   // exits are never gated
  // No core: the owner keeps idle cash in cash (2026-11-02, "Keep in cash"; playbook cash-satellite-1).
  if (p.role === "core") return "idle cash stays in cash; there is no core to buy";
  if (p.broker === "kalshi" && isCombo(p.instrument)) {
    const problem = parlayProblem(p, live);
    if (problem) return problem;
  }
  if (p.broker === "kalshi") {
    const problem = kalshiCaseProblem({ ticker: p.instrument, side: p.outcomeSide, thesis: p.thesis, resolves: p.resolves, invalidation: p.invalidation, price: p.limitPrice, fair: p.fair, sources: p.sources, stop: p.stop, target: p.target });
    return problem || kalshiPriceOffProblem(p.limitPrice, live?.ask);
  }
  const problem = caseProblem({ symbol: p.instrument, kind: p.instrumentType, thesis: p.thesis, entry: p.entry, stop: p.stop, target: p.target, invalidation: p.invalidation, sources: p.sources, catalyst: p.catalyst, trend_30d: p.trend_30d });
  return problem || entryOffProblem(Number(p.entry), live?.price, p.instrumentType === "crypto" ? "crypto" : "stock");
}

// A parlay has no order book: it is bought by accepting a maker's quote on
// Richie's own request, for that request's full size, and held to settlement since there is nothing to sell into.
export function parlayProblem(p, live) {
  if (p.outcomeSide !== "yes") return "a parlay is bought on its YES side only (every leg wins)";
  if (p.stop != null || p.target != null) return "a parlay has no stop or target: it cannot be sold before it settles, so it is held to settlement";
  if (!live?.quoteId) return "there is no open quote for this combo; quote it with kalshi_parlay_quote first, or again if it lapsed";
  if (Math.abs(Number(p.quantity) - live.contracts) > 1e-6) return `the quote is for ${live.contracts} contracts, the full size of your request; propose exactly that, or quote again at the size you want`;
  return null;
}

// Kalshi bet size (playbook cash-satellite-1: "bet size should be determined based on logic, and
// extensive review of sources"): a quarter of the Kelly fraction for the stated chance against the price with its fee,
// halved under 5 cited sources. Kelly for a contract costing c that pays $1 with chance p: (p - c) / (1 - c).
export const FULL_SIZE_SOURCES = 5;
//
// Calibration scales it: once 5 bets have settled, the Brier score of the stated chances against the results sets a
// multiplier (0.10 or better keeps full size, up to 0.20 halves it, worse quarters it; 0.25 is a coin flip).
export const CALIBRATION_MIN_BETS = 5;
export function kalshiCalibration(ledger) {
  const rows = ledger.all(`SELECT p.side, p.evidence_id, t.why FROM positions p JOIN trades t ON t.broker = p.broker AND t.instrument = p.instrument AND t.closed_at = p.closed_at AND t.paper = 0
    WHERE p.broker = 'kalshi' AND p.status = 'closed' AND t.why LIKE 'settled %'`);
  const cases = rows.map(r => {
    let fair = NaN; try { fair = Number(JSON.parse(ledger.get("SELECT packet FROM evidence WHERE id = ?", r.evidence_id)?.packet || "{}").fair); } catch {}
    return { fair: Number.isFinite(fair) ? fair : NaN, outcome: r.why === `settled ${r.side}` ? 1 : 0 };
  }).filter(c => Number.isFinite(c.fair));
  const score = brier(cases), n = cases.length;
  const multiplier = n < CALIBRATION_MIN_BETS || score == null ? 1 : score <= 0.10 ? 1 : score <= 0.20 ? 0.5 : 0.25;
  return { n, score, multiplier, line: n ? `Kalshi calibration: Brier ${score.toFixed(3)} over ${n} settled bet${n > 1 ? "s" : ""}${n < CALIBRATION_MIN_BETS ? ` (sizing uses it from ${CALIBRATION_MIN_BETS})` : `, size x${multiplier}`}` : "Kalshi calibration: no settled bets yet" };
}
export function kalshiSizing({ fair, price, quantity, sources = [], accountValue, calibration = 1 }) {
  const qty = Number(quantity) || 1, cost = Number(price) + estimatedFee({ broker: "kalshi", quantity: qty, limitPrice: Number(price) }) / qty;
  const kelly = Math.max(0, (Number(fair) - cost) / (1 - cost)), fraction = kelly / 4 * (sources.length >= FULL_SIZE_SOURCES ? 1 : 0.5) * calibration;
  const maxDollars = Number.isFinite(accountValue) ? fraction * accountValue : NaN;
  return { kelly, fraction, maxDollars, maxContracts: Math.floor(maxDollars / cost * 100 + 1e-6) / 100, costPerContract: cost };   // Kalshi counts go to 0.01
}
const sizeProblem = (p, account, cal) => {
  const s = kalshiSizing({ fair: p.fair, price: p.limitPrice, quantity: p.quantity, sources: p.sources, accountValue: account?.value, calibration: cal.multiplier });
  if (!Number.isFinite(s.maxDollars)) return "the Kalshi account value is unknown, so the bet cannot be sized. Read the account first";
  return Number(p.quantity) * s.costPerContract > s.maxDollars + 1e-9
    ? `${p.quantity} contracts cost $${(p.quantity * s.costPerContract).toFixed(2)}, above the playbook size of $${s.maxDollars.toFixed(2)} (${(s.fraction * 100).toFixed(1)}% of the account: a quarter of Kelly${(p.sources || []).length < FULL_SIZE_SOURCES ? `, halved for under ${FULL_SIZE_SOURCES} sources` : ""}${cal.multiplier < 1 ? `, x${cal.multiplier} for calibration` : ""}), so at most ${Math.max(0, s.maxContracts)} contracts` : null;
};
// A Kalshi bet refused earlier in the session may come back with a higher chance only with a source not cited before
// (2026-11-02: refused at 0.99 for an edge just under 5 cents, resent 6 seconds later at 0.995 with the same case).
const sameBet = p => `${String(p.instrument || "")}:${p.outcomeSide || ""}`;
function raisedWithoutEvidence(p, refused) {
  const before = refused?.get(sameBet(p));
  if (!before || !(Number(p.fair) > before.fair)) return null;
  return (p.sources || []).some(s => !before.sources.has(s)) ? null
    : `this bet was refused at a chance of ${before.fair} earlier in this session; a higher chance needs evidence you have not cited yet`;
}

// One proposal end to end. review(case) resolves "PASS: ..." or "FAIL: ...". liveQuote(broker, instrument, side)
// reads a fresh price. Returns the text the model sees.
export async function handleProposal(p, { ledger, broker, review, liveQuote, mode = EXECUTION_MODE, owner, adapter, paused, now = Date.now, strategyVersion = null, refused = null }) {
  const out = await proposal(p, { ledger, broker, review, liveQuote, mode, owner, adapter, paused, now, strategyVersion, refused });
  // Remember a refused Kalshi buy with its stated chance and sources, for raisedWithoutEvidence.
  if (refused && broker === "kalshi" && p.side === "buy" && Number.isFinite(Number(p.fair)) && /^Not sent/.test(out)) {
    const before = refused.get(sameBet(p));
    refused.set(sameBet(p), { fair: Math.max(Number(p.fair), before?.fair ?? 0), sources: new Set([...(before?.sources || []), ...(p.sources || [])]) });
  }
  return out;
}
async function proposal(p, { ledger, broker, review, liveQuote, mode, owner, adapter, paused, now, strategyVersion, refused }) {
  const order = { broker, instrument: String(p.instrument || "").toUpperCase(), instrumentType: p.instrumentType || (broker === "kalshi" ? "event_contract" : "stock"), side: p.side,
    outcomeSide: broker === "kalshi" ? p.outcomeSide : undefined, quantity: p.quantity, limitPrice: p.limitPrice, notional: p.notional,
    // Robinhood takes a fractional share count only at market (a limit order must be whole shares).
    orderType: broker === "robinhood" && Number.isFinite(Number(p.quantity)) && !Number.isInteger(Number(p.quantity)) ? "market" : undefined,
    // A sale's reason is what its trade row and lesson record (it was "sold" with nothing to learn from).
    plan: p.side === "sell" ? { why: String(p.thesis || "").replace(/\s+/g, " ").slice(0, 160) || "session exit", source: "session case" }
      : p.role === "core" ? { role: "core", entry: p.entry ?? null, source: "playbook core" } : { stop: p.stop ?? null, target: p.target ?? null, entry: p.entry ?? p.limitPrice ?? null, source: "session case" } };
  if (broker === "kalshi") order.instrument = String(p.instrument || "");
  // A stock or ETF market order placed while the market is closed waits for the open and can fill on a gap above the
  // price the cash check used, which on this limited-margin account would borrow. Crypto and Kalshi trade around the clock.
  if (broker === "robinhood" && order.side === "buy" && ["stock", "etf"].includes(order.instrumentType) && !marketOpen(now()))
    return "Not sent: the stock market is closed. Stock and ETF buys go only in market hours (9:30 to 4 Eastern on trading days).";
  const live = await liveQuote(broker, order.instrument, order.outcomeSide).catch(() => null);
  if (live?.quoteId) order.rfq = { rfqId: live.rfqId, quoteId: live.quoteId };   // a parlay is bought by accepting this quote
  // A fractional buy goes at market, so its limit price bounds nothing: the cash check prices it at the live price
  // when that is higher (a limit under the market let a buy past the cash it would really cost).
  if (order.side === "buy" && order.orderType === "market" && Number(order.limitPrice) > 0 && live?.price > Number(order.limitPrice)) order.limitPrice = live.price;
  const gate = gateProblem({ ...p, ...order }, live);
  if (gate) return `Not sent: ${gate}.`;
  if (broker === "kalshi" && order.side === "buy") {
    const problem = raisedWithoutEvidence(p, refused) || sizeProblem(p, ledger.account("kalshi"), kalshiCalibration(ledger));
    if (problem) return `Not sent: ${problem}.`;
  }
  const evidenceId = randomUUID();
  let verdict = "exit";
  if (order.side === "buy") {
    if (DECIDED.review !== "deepseek") throw Error(`Unknown review setting ${DECIDED.review}`);
    verdict = String(await review({ ...p, broker, livePrice: live?.price ?? null, liveAsk: live?.ask ?? null }).catch(error => `FAIL: the review did not answer (${error.message.slice(0, 80)})`)).trim();
  }
  ledger.saveEvidence({ id: evidenceId, subject: order.instrument, role: "case", verdict, status: /^PASS|^exit$/.test(verdict) ? "complete" : "incomplete", strategyVersion, createdAt: now(),
    packet: { question: `${order.side} ${order.instrument}`, ...(broker === "kalshi" && Number.isFinite(Number(p.fair)) ? { fair: Number(p.fair), side: order.outcomeSide } : {}), items: (p.sources || []).map(s => ({ fact: "Cited in Richie's case", source: /^https?:\/\//.test(s) ? s : "", note: s, observedAt: now(), unknowns: [] })), countercase: p.invalidation, assumptions: [], thesis: p.thesis } });
  if (order.side === "buy" && !/^PASS/i.test(verdict)) return `Not sent: the review said ${verdict.slice(0, 300)}`;
  // Observation stops submitOrder() before its policy check, so a preview is checked here: it shows only orders
  // that would really have been allowed (cash, fresh balance, product, holdings).
  if (mode !== "live") {
    const problem = orderProblem(order, { account: ledger.account(broker), held: ledger.position(positionId(broker, order.instrument, order.outcomeSide || "long")), paused: await (paused?.() ?? false), now: now() });
    if (problem) return `Not sent: ${problem}`;
  }
  const result = await submitOrder({ ledger, adapter, order: { ...order, evidenceId }, mode, owner, paused, now });
  if (result.state === "blocked" && result.wouldSubmit) {
    ledger.alert({ kind: "trade_preview", severity: "info", subject: order.instrument, at: now(), dedupe: `trade_preview:${evidenceId}`,
      text: `Watch-only: would ${order.side} ${order.quantity ?? money(order.notional)} ${order.instrument}${order.limitPrice ? ` at ${order.limitPrice}` : ""}. Review: ${verdict.slice(0, 120)}` });
    return `Previewed, not sent (observation mode). The order passed the case gates${order.side === "buy" ? " and the review" : ""}.`;
  }
  // A refusal or cancel says why, so a lapsed parlay quote reads as one to quote again.
  const why = ["rejected", "cancelled"].includes(result.state) && result.clientId ? ledger.order(result.clientId)?.reason : null;
  return result.state === "blocked" ? `Not sent: ${result.reason}` : `Order ${result.state}${result.clientId ? ` (client id ${result.clientId})` : ""}${why ? `: ${why}` : ""}.`;
}

// model(messages, tools) resolves an OpenAI-style assistant message. tools: { name: { def, run(args) } } look-only.
async function loop({ model, system, user, tools, onTool, history = [] }) {
  const defs = Object.values(tools).map(t => ({ type: "function", function: t.def }));
  const messages = [{ role: "system", content: system }, ...history, { role: "user", content: user }], used = [];
  for (let step = 0; step < MAX_STEPS; step++) {
    const msg = await model(messages, defs);
    if (!msg) throw Error("The model sent no message");
    messages.push(msg);
    if (!msg.tool_calls?.length) return { text: String(msg.content || "").trim(), used };
    for (const call of msg.tool_calls) {
      const name = call.function?.name, tool = tools[name];
      let args = {}; try { args = JSON.parse(call.function?.arguments || "{}"); } catch { /* bad JSON is reported to the model below */ }
      used.push(name);
      const out = !tool ? `Error: there is no tool ${name}.` : await Promise.resolve(tool.run(args)).catch(error => `Error: ${String(error.message).slice(0, 300)}`);
      onTool?.(name, args, out);
      messages.push({ role: "tool", tool_call_id: call.id, content: String(out).slice(0, 6000) });
    }
  }
  // Out of steps: one last turn with no tools, so the session always ends with what it found and decided.
  messages.push({ role: "user", content: "You are out of research steps. Stop now and write your summary: what you looked at, what you decided, and why." });
  const last = await model(messages, []).catch(() => null);
  return { text: String(last?.content || "").trim() || "Stopped after the step limit without a summary.", used, ranOut: true };
}

const accountsLine = ledger => ledger.accounts().map(a => `${a.broker} cash ${money(a.cash)}, value ${money(a.value)}`).join("; ") || "none read yet";

export async function runSession({ ledger, broker, model, review, lookTools = {}, liveQuote, strategy, nowText, mode = EXECUTION_MODE, owner, adapter, paused, now = Date.now, onTool }) {
  const proposals = [], refused = new Map();
  const tools = { ...lookTools, propose_trade: { def: PROPOSE_TRADE, run: async a => { const out = await handleProposal(a, { ledger, broker, review, liveQuote, mode, owner, adapter, paused, now, strategyVersion: strategy?.version, refused }); proposals.push({ instrument: a.instrument, side: a.side, out }); return out; } } };
  const system = sessionPrompt({ broker, now: nowText, strategy, accounts: accountsLine(ledger) });
  const { text, used } = await loop({ model, system, user: `Run the ${broker} session now.`, tools, onTool });
  return { summary: text, used, proposals };
}

// Chat: look-only tools plus start_session, which only records the request for the caller to run afterwards.
// history: the last exchanges as [{ q, a }], so "and XLE?" follows on (the legacy bot kept 8).
export async function chatTurn({ ledger, model, lookTools = {}, text, nowText, onTool, history = [] }) {
  let requested = null;
  const tools = { ...lookTools, start_session: { def: { name: "start_session", description: "Start a trading session right after this reply, with the owner's request in it.", parameters: { type: "object", additionalProperties: false, required: ["broker"],
    properties: { broker: { type: "string", enum: ["robinhood", "kalshi"] }, request: { type: "string" } } } }, run: a => { requested = { broker: a.broker, request: String(a.request || text).slice(0, 600) }; return `The ${a.broker} session starts as soon as this reply is sent.`; } } };
  const positions = ledger.positions("open").map(p => `${p.instrument} ${p.quantity} (${p.protection_mode})`).join("; ") || "none";
  const health = ledger.health().filter(h => h.status !== "ok").map(h => `${h.component} ${h.status}`).join("; ") || "all ok";
  // His own order records are the truth: Robinhood's order list never shows an order it refused (2026-11-02, DVN).
  const orders = ledger.all("SELECT * FROM orders ORDER BY updated_at DESC LIMIT 6").map(o => `${o.side} ${o.instrument} ${o.state}${o.reason ? ` (${String(o.reason).slice(0, 120)})` : ""}`).join("; ") || "none";
  const alertsOpen = ledger.alerts().filter(a => a.severity === "important").map(a => a.text).join(" | ") || "none";
  const system = `${chatPrompt({ now: nowText, accounts: accountsLine(ledger), positions, health })}
Your own order records, newest first (these are the truth about your orders; Robinhood's order list never shows an order it refused): ${orders}. Unresolved orders: ${ledger.openOrders().length}. Open alerts: ${alertsOpen}. When asked about orders or errors, answer from these records.`;
  const out = await loop({ model, system, user: text, tools, onTool,
    history: history.flatMap(h => [{ role: "user", content: h.q }, { role: "assistant", content: h.a }]) });
  return { reply: out.text, used: out.used, requested };
}

// The DeepSeek reviewer (the only second opinion). model resolves an assistant message.
export const REVIEWER = `You check a trading case for Richie, a small trading agent, before any money moves. Be strict but fair. Pass it only if the thesis is concrete and supported by the listed sources, the price is the live price given, the exit plan is sensible for the instrument's normal moves, and for Kalshi the fair chance is argued from evidence and beats the price after fees. For Kalshi, FAIL when the cited sources contradict each other on the outcome, and at a price of 90 cents or more pass only if published data already settles most of the outcome (a strong lean is not enough there, since a small error in the chance erases the edge). For a Kalshi parlay (instrument starting KXMVE), fair is the joint chance that every leg wins: FAIL unless the thesis lists each leg with its market price and Richie's chance, each chance stays near its market price unless named news justifies more, and linked legs are joined for correlation rather than just multiplied. Answer with one line: PASS: <reason> or FAIL: <what is missing>.`;
export const reviewer = model => async c => (await model([{ role: "system", content: REVIEWER }, { role: "user", content: JSON.stringify(c) }], []))?.content ?? "FAIL: no answer";

// OpenRouter chat completions, with each call's cost passed to onCost. No key is read here.
export function openrouterModel({ key, model, fetcher = fetch, onCost = () => {}, limits = { max_tokens: 5000 } }) {
  return async (messages, tools) => {
    const response = await fetcher("https://openrouter.ai/api/v1/chat/completions", { method: "POST", signal: AbortSignal.timeout(180000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Richie rebuild" },
      body: JSON.stringify({ model, messages, ...(tools.length ? { tools, tool_choice: "auto" } : {}), ...limits, usage: { include: true } }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(`openrouter ${response.status}: ${JSON.stringify(body).slice(0, 200)}`);
    onCost(Number(body.usage?.cost) || 0, model);
    return body.choices?.[0]?.message;
  };
}
