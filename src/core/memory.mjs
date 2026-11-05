// Optional long-term memory: any MCP memory server that offers memory_save, memory_add, memory_list, memory_read and
// memory_search tools (set RICHIE_MEMORY_URL and the secret "memory"). Notes live in agents/richie/*.
// Code, not the model, writes his trade records and weekly lessons. The model gets look-only tools,
// plus a save into agents/richie/market-notes in chat when the owner asks him to remember something.
// Memory never touches trading: every write here is caught and logged by the caller.

const MEMORY_URL = process.env.RICHIE_MEMORY_URL || "http://127.0.0.1:8790/mcp/";
export const NOTES_FOLDER = "agents/richie/market-notes";

// A minimal MCP JSON-RPC client; the key is appended to the URL. The url is passable for tests.
export function memoryClient(key, url = MEMORY_URL) {
  let id = 0;
  const rpc = async (method, params) => {
    const response = await fetch(url + encodeURIComponent(key), { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }), signal: AbortSignal.timeout(20000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`memory ${response.status}: ${text.slice(0, 200)}`);
    const body = JSON.parse(text);
    if (body.error) throw new Error(body.error.message || "memory server error");
    return body.result;
  };
  return {
    async tools(names) {
      const { tools } = await rpc("tools/list", {});
      return tools.filter(t => names.includes(t.name))
        .map(t => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema || { type: "object", properties: {} } } }));
    },
    async call(name, args) {
      const result = await rpc("tools/call", { name, arguments: args });
      const text = (result.content || []).map(c => c.text || "").join("\n");
      return result.isError ? `Error: ${text}` : text;
    },
  };
}

const pct = r => Number.isFinite(r) ? `${r >= 0 ? "+" : ""}${(r * 100).toFixed(1)}%` : "?";
const day = ms => new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/New_York" });   // YYYY-MM-DD

const compact = ms => day(ms).replace(/-/g, "");   // 20261018
// One line per closed trade: "NVDA stock, 20261014 to 20261018: bought 100, sold 112 (target), +12.0%, $4.00 in; stop 93, target 112".
export const tradeLine = t => `${t.sym}${t.kind ? ` ${t.kind}` : ""}, ${t.opened ? `${compact(t.opened)} to ` : ""}${compact(t.closed)}: bought ${t.entry}, sold ${Number.isFinite(t.exit) ? t.exit : "?"} (${t.why}), ${pct(t.ret)}${t.dollars ? `, $${Number(t.dollars).toFixed(2)} in` : ""}; stop ${t.stop}, target ${t.target}`;
const monthName = ms => new Date(ms).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", year: "numeric" });

// The month's trade note ids from memory_list's answer ("[id] agents/richie/trades | Trades 2026-10: ..."), newest first.
export function monthNotes(listText, month) {
  const out = [];
  for (const m of String(listText).matchAll(/^\[([^\]]+)\] agents\/richie\/trades \| (Trades [0-9-]+(?: part \d+)?):/gm))
    if (m[2] === `Trades ${month}` || m[2].startsWith(`Trades ${month} part `)) out.push({ id: m[1], title: m[2] });
  return out;
}

// Records a closed trade in agents/richie/trades: one note per month, a dated line added for each trade.
// A full note (2,000 characters) gets a "part 2". A month's note is made with a header only, then the line
// is added: the server refuses a new note whose words are nearly all in another note, and a first trade
// line alone would look like a copy of last month's note. Returns what the server said.
export async function recordTrade(mem, t) {
  const month = day(t.closed).slice(0, 7), line = tradeLine(t);
  const notes = monthNotes(await mem.call("memory_list", { folder: "agents/richie/trades", limit: 200 }), month);
  if (notes.length) {
    const out = await mem.call("memory_add", { id: notes[0].id, text: line });
    if (!/^Error/.test(out) || !/limit/i.test(out)) return out;
  }
  const part = notes.length + 1, title = part > 1 ? `Trades ${month} part ${part}` : `Trades ${month}`;
  const saved = await mem.call("memory_save", { folder: "agents/richie/trades", title, summary: `Richie's closed real trades in ${month}, one line each, recorded by code.`,
    text: `Richie's closed real trades for ${monthName(t.closed)} (${compact(t.closed).slice(0, 6)})${part > 1 ? `, continued in part ${part}` : ", recorded by code, one line per trade"}.` });
  const id = String(saved).match(/^Saved: \[([^\]]+)\]/)?.[1];
  return id ? mem.call("memory_add", { id, text: line }) : saved;
}

// After the weekly review: the playbook's Lessons section in one note, agents/richie/lessons "Weekly review
// lessons", rewritten each week (the server keeps every earlier text in its history). One note, not one a
// week: the review keeps the 12 most useful lessons, so a new week's note would be refused as a copy.
const LESSONS_TITLE ="Weekly review lessons";
export function lessonsOf(playbook) {
  return String(playbook).split("## Lessons")[1]?.split(/\n## /)[0].trim().slice(0, 1900) || null;
}
export async function saveLessons(mem, playbook, now = Date.now()) {
  const lessons = lessonsOf(playbook);
  if (!lessons) return "no lessons section";
  const text = `From the weekly review of ${day(now)}:\n${lessons}`, summary = `Richie's current trading lessons, from his weekly review (last ${day(now)}).`;
  const found = String(await mem.call("memory_list", { folder: "agents/richie/lessons", limit: 200 })).match(new RegExp(`^\\[([^\\]]+)\\] agents/richie/lessons \\| ${LESSONS_TITLE}:`, "m"));
  return found ? mem.call("memory_update", { id: found[1], text, summary })
    : mem.call("memory_save", { folder: "agents/richie/lessons", title: LESSONS_TITLE, summary, text });
}

// In chat, a save only into his market notes, and only when the owner's own message asks him to remember.
export const asksToRemember = text => /\b(remember|note (this|that|it)|make a note|keep in mind|don'?t forget|write (this|that|it) down|save (this|that|it))\b/i.test(String(text));
export function chatSaveProblem(text, args = {}) {
  if (!asksToRemember(text)) return "Error: you save to memory only when the owner asks you to remember something.";
  if (String(args.folder || "").trim().toLowerCase().replace(/^\/+|\/+$/g, "") !== NOTES_FOLDER) return `Error: in chat you save only to ${NOTES_FOLDER}.`;
  return null;
}
