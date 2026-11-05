// Delegated research. Workers get one question, read-only tools and a budget, and return a
// typed evidence packet. They cannot reach order, broker-write, memory-write or policy functions: the
// dispatcher hands them a tool table built only from READ_TOOLS, and a call to anything else throws.
// Provider is "disabled" until the owner sets a spend and latency budget; tests use the fixture provider.
import { SETTINGS } from "./config.mjs";

export const READ_TOOLS = new Set(["web_search", "web_read", "quote", "historicals", "kalshi_market", "kalshi_markets", "filings_recent", "weather_evidence", "economic_calendar", "memory_search", "memory_read"]);
const FORBIDDEN = /place|order|cancel|buy|sell|kalshi_case|write_case|memory_save|memory_update|memory_add|policy|transfer/i;

// An evidence packet is usable only if every item says where it came from, when, and what is unknown.
export function packetProblems(p, now = Date.now()) {
  const problems = [];
  if (!p || typeof p !== "object") return ["no packet"];
  if (!["supports", "opposes", "insufficient evidence"].includes(p.recommendation)) problems.push("recommendation must be supports, opposes or insufficient evidence");
  if (!Array.isArray(p.items) || !p.items.length) problems.push("no evidence items");
  for (const [i, item] of (p.items || []).entries()) {
    if (!/^https?:\/\//.test(item.source || "")) problems.push(`item ${i + 1} has no source link`);
    if (!Number.isFinite(item.observedAt)) problems.push(`item ${i + 1} has no observed time`);
    else if (item.observedAt > now + 60000) problems.push(`item ${i + 1} is dated in the future`);
    if (!Array.isArray(item.unknowns)) problems.push(`item ${i + 1} does not list its unknowns`);
  }
  if (!String(p.countercase || "").trim()) problems.push("no countercase");
  if (!Array.isArray(p.assumptions)) problems.push("no assumptions listed");
  return problems;
}
// Adds data age to each item and marks the packet stale if any item is past its validity window.
export function agePacket(p, validityMs, now = Date.now()) {
  const items = p.items.map(item => ({ ...item, ageMs: now - item.observedAt, stale: now - item.observedAt > validityMs }));
  return { ...p, items, stale: items.some(i => i.stale) };
}

// tools: { name: async (args) => text } for the real read tools. Workers see only names in READ_TOOLS.
export function scopedTools(tools, budget) {
  let calls = 0;
  return new Proxy({}, { get(_, name) {
    if (typeof name !== "string") return undefined;
    if (!READ_TOOLS.has(name) || FORBIDDEN.test(name)) throw Error(`Research workers cannot call ${name}`);
    if (!tools[name]) throw Error(`${name} is not connected`);
    return async args => { if (++calls > budget.maxCallsPerWorker) throw Error("Tool-call budget spent"); return tools[name](args); };
  } });
}

// provider(task, tools) returns a packet. tasks: [{ id, subject, role, question, validityMs }].
// spent() is today's research spend in dollars and record(cost) adds to it; a provider reports a worker's cost as
// packet.cost. Once the day's budget is spent, no worker starts and the session goes without.
export async function dispatch(tasks, { provider = SETTINGS.research.provider, tools = {}, budget = SETTINGS.research, cache = new Map(), now = Date.now, strategyVersion,
  spent = () => 0, record = () => {} } = {}) {
  if (provider === "disabled" || !provider) return tasks.map(t => ({ ...t, status: "disabled", packet: null, note: "Research delegation is off." }));
  if (Number.isFinite(budget.dailyUsd) && spent() >= budget.dailyUsd) return tasks.map(t => ({ ...t, status: "skipped", packet: null, problems: ["today's research budget is spent"] }));
  const started = now(), results = [];
  const run = async t => {
    const key = `${t.subject}|${t.role}|${t.question}`, hit = cache.get(key);
    if (hit && !agePacket(hit.packet, t.validityMs, now()).stale) return { ...t, status: "complete", packet: agePacket(hit.packet, t.validityMs, now()), cached: true };
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(Error("Research timed out")), budget.maxMs); });
    try {
      const packet = await Promise.race([provider(t, scopedTools(tools, budget)), timeout]);
      record(Number(packet?.cost) || 0);
      const problems = packetProblems(packet, now());
      if (problems.length) return { ...t, status: "incomplete", packet, problems };
      const aged = agePacket(packet, t.validityMs, now());
      if (aged.stale) return { ...t, status: "incomplete", packet: aged, problems: ["stale evidence"] };
      cache.set(key, { packet, at: now() });
      return { ...t, status: aged.recommendation === "insufficient evidence" ? "incomplete" : "complete", packet: aged, strategyVersion };
    } catch (error) { return { ...t, status: "incomplete", packet: null, problems: [String(error.message).slice(0, 120)] }; }
    finally { clearTimeout(timer); }
  };
  // At most maxWorkers at once; the rest are reported as not run rather than queued without bound.
  for (const t of tasks.slice(0, budget.maxWorkers)) results.push(run(t));
  const done = await Promise.all(results);
  for (const t of tasks.slice(budget.maxWorkers)) done.push({ ...t, status: "skipped", packet: null, problems: ["over the worker budget"] });
  // Workers that disagree make the case incomplete; Richie synthesizes, a worker never decides.
  const verdicts = new Set(done.filter(d => d.status === "complete").map(d => d.packet.recommendation));
  return Object.assign(done, { elapsedMs: now() - started, disagreement: verdicts.has("supports") && verdicts.has("opposes") });
}

// A deterministic provider for tests and the offline demo: returns the fixture packet for the task id.
export const fixtureProvider = packets => async (task, tools) => {
  const p = packets[task.id];
  if (p?.useTool) await tools[p.useTool]({});
  if (p?.hang) return new Promise(() => {});
  return p?.packet;
};
