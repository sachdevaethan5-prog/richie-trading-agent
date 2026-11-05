// Richie's voice and Telegram messages. Replaces richie/voice.mjs for the rebuild: standard
// capitalization (no lowercase transform), no persona slang, one or two short sentences and usually 30 words or
// fewer, result first. Trade and alert messages are built by code from the ledger so numbers and order states
// are exact; the model only writes free-form chat and requested summaries, under the same instruction.
import { FIXED } from "./config.mjs";

export const VOICE = `Your voice: a candid, measured trading colleague texting the owner. Standard capitalization and punctuation. Lead with the result, then at most one reason or next step. Default to one or two short sentences, usually ${FIXED.telegramWords} words or fewer. Have a clear point of view without performing a persona: no forced slang, no hype, no greetings or sign-offs. A relevant emoji is optional and occasional, never required. Keep the research trail, sources and screened candidates in the journal unless the owner asks for them. Give order states exactly as recorded (submitted, partially filled, filled, rejected, cancelled, unknown) and never turn an unknown into a success. Keep exact prices, sizes, tickers and links. An important alert may run longer, only as needed to state the issue, its impact and the action. Plain text, no em or en dashes. This voice never changes a trading rule or check.`;

// Dashes out (outside links), whitespace tidied, nothing else changed. Capitalization is left alone.
export function telegramText(value) {
  return String(value).split(/(https?:\/\/\S+)/gi).map((part, i) => i % 2 ? part : part.replace(/\s*[\u2013\u2014]\s*/g, ", ").replace(/[ \t]+/g, " ")).join("").trim();
}
export const wordCount = text => String(text).replace(/https?:\/\/\S+/g, "link").split(/\s+/).filter(Boolean).length;
export const sentenceCount = text => String(text).replace(/https?:\/\/\S+/g, "link").replace(/\$?\d+\.\d+/g, "0").split(/[.!?]+(?:\s|$)/).filter(s => s.trim()).length;
export const fitsDefault = text => wordCount(text) <= FIXED.telegramWords && sentenceCount(text) <= 2;

const money = n => `$${Number(n).toFixed(2)}`;
const qty = n => String(Number(Number(n).toFixed(6)));
const priceOf = (o, p) => o.broker === "kalshi" ? `${Math.round(p * 100)}¢` : money(p);
const what = o => o.broker === "kalshi" ? `${o.instrument} ${String(o.outcome_side || "").toUpperCase()}` : o.instrument;
const verb = o => o.side === "buy" ? "Buy" : "Sell";

// One message per order state, from the ledger row. Each fits the default length.
export function orderMessage(o) {
  const size = o.requested_qty ? `${qty(o.requested_qty)} ${what(o)}${o.limit_price && o.order_type !== "market" ? ` at up to ${priceOf(o, o.limit_price)}` : o.order_type === "market" ? " at market" : ""}` : `${money(o.notional)} of ${what(o)}`;
  switch (o.state) {
    case "submitted": return `${verb(o)} submitted: ${size}. Waiting on the fill before I count it.`;
    case "partially_filled": return `Partial fill: ${qty(o.filled_qty)}${o.requested_qty ? ` of ${qty(o.requested_qty)}` : ""} ${what(o)} at ${priceOf(o, o.avg_price)}. The rest is still working.`;
    case "filled": return `Filled: ${o.side === "buy" ? "bought" : "sold"} ${qty(o.filled_qty)} ${what(o)} at ${priceOf(o, o.avg_price)}, fees ${money(o.fees)}.`;
    case "rejected": return `Rejected: the ${o.side} of ${what(o)} was refused${o.reason ? ` (${o.reason.replace(/^\w+: /, "").slice(0, 60)})` : ""}. Nothing changed.`;
    case "cancelled": return o.filled_qty > 0 ? `Cancelled after a partial fill: ${qty(o.filled_qty)} ${what(o)} at ${priceOf(o, o.avg_price)}. The rest did not fill.` : `Cancelled: the ${o.side} of ${what(o)} did not fill. Nothing changed.`;
    case "unknown": return `Unknown: the ${what(o)} ${o.side} may have reached ${o.broker}. I won't resend until the broker record shows what happened.`;
    default: return null;   // intent and blocked are internal states, not messages
  }
}

// Which events may message the owner unasked: trades, material position changes and important alerts. Routine scans,
// quote refreshes, "setup forming" notes and periodic recaps stay in the journal and dashboard.
export function notifyDecision(event) {
  if (event.requested) return "send";   // he asked: answer it
  if (event.kind === "order") return ["submitted", "partially_filled", "filled", "rejected", "cancelled", "unknown"].includes(event.state) ? "send" : "silent";
  if (event.kind === "position_change") return "send";
  if (event.kind === "alert") return event.severity === "important" ? "send" : "silent";
  return "silent";   // scan, quote, setup, daily/weekly/monthly recap
}
