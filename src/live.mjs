#!/usr/bin/env node
// Richie, live: the only process that trades. It holds the execution lease, runs the monitor lanes with real exits,
// reconciles every minute, sends order and alert messages, and answers your commands on Richie's Telegram bot. Every order goes through submitOrder(): lease, unresolved-order block,
// policy (cash only, fresh balance, approved products, pause, holdings), durable intent, then the broker.
//   node src/live.mjs --live [--ledger FILE]
// Without --live it refuses to start; the mode string reaches submitOrder() only from here.
import { appendFile, mkdir } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { LEDGER_FILE, LOG_FILE, secret } from "./env.mjs";
import { openLedger } from "./ledger.mjs";
import { scheduler } from "./monitor.mjs";
import { EXECUTION_LEASE } from "./execution.mjs";
import { protectionState } from "./monitor.mjs";
import { errorClass, backoff } from "./health.mjs";
import { observerJobs, lazyConnection, robinhoodParts } from "./runner.mjs";
import { kalshiAdapter } from "./adapters/brokers.mjs";
import { kalshiReader } from "./adapters/readers.mjs";
import { telegramClient, telegramTransport } from "./telegram.mjs";
import { liveExtras } from "./live-sessions.mjs";
import { kalshiCalibration } from "./sessions.mjs";
import { openInbox, runControls } from "./controls.mjs";
import { scoreboard } from "./core/lib.mjs";
import { marketOpen } from "./runner.mjs";

const MIN = 60000, LEASE_MS = 2 * MIN;
const money = n => Number.isFinite(n) ? `$${n.toFixed(2)}` : "unknown";

// The only Robinhood tools the live process may call: look-only and order placement (no cancels, transfers or options).
export const tradingRobinhood = (rh, toolKind) => ({ call: (name, args) => ["read", "order"].includes(toolKind(name)) ? rh.call(name, args)
  : Promise.reject(Error(`Live Richie does not call ${name}`)) });

export function statusText(ledger, now = Date.now()) {
  const accounts = ledger.accounts().map(a => `${a.broker === "robinhood" ? "Robinhood" : "Kalshi"} ${money(a.value)} (cash ${money(a.cash)})`).join(", ");
  const positions = ledger.positions("open").map(p => `${p.instrument} ${Number(p.quantity.toFixed(6))} ${protectionState(p, now).state}`).join(", ") || "none";
  const open = ledger.openOrders().length, alerts = ledger.alerts().filter(a => a.severity === "important").length;
  const board = `Scoreboard: ${scoreboard(ledger.trades(false)).line}. Paper: ${scoreboard(ledger.trades(true)).line}. ${kalshiCalibration(ledger).line}.`;
  let month = null; try { month = JSON.parse(ledger.meta("month") || "null"); } catch {}
  const sign = x => `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`;
  const mtd = month?.now && month.start.value > 0 ? ` This month: account ${sign(month.now.value / month.start.value - 1)}, SPY ${sign(month.now.spy / month.start.spy - 1)} (since ${new Date(month.start.at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}).` : "";
  return `${accounts}. Positions: ${positions}. ${board}${open ? ` ${open} order${open > 1 ? "s" : ""} unresolved.` : ""}${alerts ? ` ${alerts} open alert${alerts > 1 ? "s" : ""}.` : ""}${mtd}${ledger.meta("paused") === "1" ? " Paused: no new buys; exits still run." : ""}`;
}

// The owner's commands; anything else goes to chat (handed in by main, so tests can run without a model).
// One batch of Telegram updates: only the owner's chat, each message logged, answered and its reply recorded.
export async function handleUpdates(updates, { ledger, chatId, send, ctx, log = () => {} }) {
  let offset = null;
  for (const u of updates) {
    offset = u.update_id + 1; ledger.meta("telegram_offset", offset);
    // The live menu (menu.mjs): taps and "/menu" are plain code.
    if (u.callback_query) { if (ctx?.menu) await ctx.menu.handle(u.callback_query).catch(error => log({ event: "menu_error", error: error.message })); continue; }
    if (ctx?.menu?.isMenu(u.message?.text) && String(u.message.chat?.id) === String(chatId)) { await ctx.menu.open().catch(error => log({ event: "menu_error", error: error.message })); continue; }
    if (String(u.message?.chat?.id) !== String(chatId) || !u.message?.text) continue;
    await log({ event: "message", text: u.message.text.slice(0, 300) });
    ledger.event({ at: Date.now(), kind: "message", text: `Owner: ${u.message.text.slice(0, 400)}` });
    const reply = await command(u.message.text, { ledger, ...ctx }).catch(async error => { await log({ event: "chat_error", error: error.message }); return `That hit an error (${errorClass(error)}). Status, pause and resume still work.`; });
    if (reply) { ledger.event({ at: Date.now(), kind: "reply", text: `Richie: ${reply.slice(0, 600)}` }); await send(reply); }
  }
  return offset;
}

export async function command(text, { ledger, chat, journal = null, start = null }) {
  const t = String(text || "").trim().toLowerCase().replace(/[?!.\s]+$/, "");   // "status?" is still the command
  if (journal && /^\/?kalshi journal$/.test(t)) return journal("kalshi");
  if (journal && /^\/?journal$/.test(t)) return journal("robinhood");
  if (start && /^\/?(run )?kalshi( now)?$/.test(t)) return start("kalshi");
  if (start && /^\/?(run|check)( now)?$/.test(t)) return start("robinhood");
  if (/^\/?(status|how are (you|we) doing\??)$/.test(t)) return statusText(ledger);
  if (/^\/?pause$/.test(t)) { ledger.meta("paused", "1"); return "Paused new buys. Exits and stop checks keep running. Send resume to undo."; }
  if (/^\/?resume$/.test(t)) { ledger.meta("paused", "0"); return "Resumed. New buys allowed again under the usual checks."; }
  if (/^\/?(help|start|commands)$/.test(t)) return "I'm Richie. Commands: menu (live panels), status, journal, kalshi journal, run (a stock session now), kalshi (a Kalshi session now), pause, resume. Anything else, just ask.";
  return chat(text);
}

async function main() {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  if (!args.includes("--live")) throw Error("live.mjs trades real money and starts only with --live");
  const file = arg("--ledger") || LEDGER_FILE;
  await mkdir(dirname(file), { recursive: true });
  await mkdir(dirname(LOG_FILE), { recursive: true });
  const log = e => appendFile(LOG_FILE, JSON.stringify({ at: new Date().toISOString(), live: true, ...e }) + "\n").catch(() => {});
  const ledger = openLedger(file);
  const owner = `live-${process.pid}-${Date.now()}`;
  if (!ledger.lease(EXECUTION_LEASE, owner, LEASE_MS)) throw Error("Another process holds the execution lease; not starting");
  // A restart hands the lease straight to the next process instead of waiting for it to expire.
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { try { ledger.release(EXECUTION_LEASE, owner); } finally { process.exit(0); } });
  const [{ runnerConnect }, { connect: kalshiConnect }, { agenticAccount, toolKind }] = await Promise.all([import("./signin.mjs"), import("./core/kalshi.mjs"), import("./core/lib.mjs")]);
  const rh = tradingRobinhood(lazyConnection(() => runnerConnect({ log, readOnly: n => toolKind(n) === "read" })), toolKind);
  const parts = robinhoodParts({ rh, ledger, log, agenticAccount });
  const readers = { robinhood: parts.reader }, adapters = { robinhood: parts.adapter };
  let ks = null;
  try { ks = await kalshiConnect(); readers.kalshi = kalshiReader(ks); adapters.kalshi = kalshiAdapter(ks); }
  catch (error) { ledger.healthError("broker_sync:kalshi", errorClass(error), Date.now(), String(error.message).slice(0, 160)); await log({ event: "connect_error", broker: "kalshi", error: error.message }); }
  const [token, chatId] = await Promise.all([secret("telegram-token"), secret("telegram-chat-id")]);
  const call = telegramTransport({ token });
  const telegram = telegramClient({ call, chatId, ledger });
  const paused = async () => ledger.meta("paused") === "1";
  const exec = { mode: "live", owner, adapters, paused };
  const key = await secret("openrouter");
  // Optional: an MCP memory server (core/memory.mjs) for trade records, lessons and notes. Off unless configured.
  const memKey = process.env.RICHIE_MEMORY_URL ? await secret("memory").catch(() => null) : null;
  const { memoryClient } = await import("./core/memory.mjs");
  const extra = liveExtras({ ledger, rh, parts, ks, exec, key, log, mem: memKey ? memoryClient(memKey) : null, open: marketOpen, dataDir: dirname(file) });
  const jobs = [
    { name: "lease", lane: "lease", priority: 0, intervalMs: 30000, run: async () => { if (!ledger.lease(EXECUTION_LEASE, owner, LEASE_MS)) { await log({ event: "lease_lost", error: "execution lease taken by another owner" }); process.exit(1); } } },
    ...observerJobs({ ledger, readers, adapters, telegram, exec, backupDir: join(dirname(file), "backups") }),
    ...extra.jobs,
  ].map(j => ({ ...j, run: () => Promise.resolve(j.run()).catch(async error => { await log({ event: "job_error", job: j.name, error: error.message }); throw error; }) }));
  const sched = scheduler({ ledger, jobs });
  await log({ event: "start", mode: "live", owner, brokers: Object.keys(readers) });
  ledger.event({ at: Date.now(), kind: "system", text: "Live Richie started and took the trading lease." });
  setInterval(() => sched.tick(), 15000);
  sched.tick();
  // Dashboard controls (CONTROLS.md): the inbox is read every 5 seconds, one pass at a time.
  const inbox = openInbox(join(dirname(file), "controls", "inbox.db"));
  let controlBusy = false;
  setInterval(async () => {
    if (controlBusy) return;
    controlBusy = true;
    try { await runControls({ inbox, ledger, exec, readers, start: extra.start, notify: t => telegram.send(t, "control") }); }
    catch (error) { await log({ event: "job_error", job: "controls", error: error.message }); }
    finally { controlBusy = false; }
  }, 5000);
  const chat = extra.chat;
  const [{ liveMenu, setCommands, setDashboardButton, writeLive }, { richiePanels, richieLive }] = await Promise.all([import("./shared/tg-menu.mjs"), import("./menu.mjs")]);
  const menu = liveMenu({ token, chatId, title: "Richie", panels: richiePanels(ledger), app: "richie", log });
  setDashboardButton(token, "richie");
  let liveError = "";   // for the dashboard; a failure is logged once, not every second
  setInterval(() => { Promise.resolve().then(() => writeLive("richie", richieLive(ledger))).then(() => { liveError = ""; },
    error => { if (error.message !== liveError) log({ event: "live_file_error", error: (liveError = error.message) }); }); }, 1000);
  setCommands(token, [["menu", "Live panels: current task, health, dashboard"], ["status", "Accounts and positions"], ["journal", "Robinhood journal"], ["pause", "Pause new buys"], ["resume", "Allow new buys"]]);
  let offset = Number(ledger.meta("telegram_offset") || 0), failures = 0;
  for (;;) {
    const got = await telegram.receive(offset);
    if (!got.ok) { await new Promise(r => setTimeout(r, backoff(failures++))); continue; }
    failures = 0;
    const next = await handleUpdates(got.updates, { ledger, chatId, send: t => telegram.send(t, "reply"), ctx: { chat, journal: extra.journal, start: extra.start, menu }, log });
    if (next != null) offset = next;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(async error => { console.error(error.message); process.exit(1); });
