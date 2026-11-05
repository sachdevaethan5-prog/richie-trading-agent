// A live button menu in Richie's Telegram chat: health, current task and a small dashboard, updated every second. "/menu" sends one message with a button per
// panel; the open panel is re-rendered every second and the message edited in place when its text changed. Telegram
// cannot go faster than that (about one edit a second per chat before it answers 429), so live mode runs for
// LIVE_MS after the last tap and then pauses with a Go live button, rather than editing all day.
// Each bot already long-polls getUpdates; it must ask for "callback_query" too and hand those to handle().
const LIVE_MS = 10 * 60000;
import { writeFile, rename, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DATA_DIR } from "../env.mjs";
// Optional: a Telegram Mini App URL for the menu's "Open dashboard" button (your own hosted dashboard, HTTPS).
export const APP_URL = process.env.RICHIE_APP_URL || null;
// What Richie is doing now, written every second for a dashboard to read.
const LIVE_DIR = join(DATA_DIR, "live");
export async function writeLive(agent, value) {
  await mkdir(LIVE_DIR, { recursive: true });
  // Own temp name per call: writes can overlap (a slow disk, the 1 s timer), and two sharing one name made the second rename ENOENT.
  const file = join(LIVE_DIR, `${agent}.json`), tmp = `${file}.${process.pid}.${++liveSeq}.tmp`;
  await writeFile(tmp, JSON.stringify({ at: Date.now(), ...value }));
  await rename(tmp, file);
}
let liveSeq = 0;
// The chat's menu button (by the text box) opens the agent's dashboard, like BotFather's own.
export const setDashboardButton = (token, agent) => !APP_URL ? Promise.resolve() : fetch(`https://api.telegram.org/bot${token}/setChatMenuButton`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ menu_button: { type: "web_app", text: "Dashboard", web_app: { url: `${APP_URL}?a=${agent}` } } }), signal: AbortSignal.timeout(10000) }).catch(() => {});
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const clock = at => new Date(at).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });

// panels: [{ id, label, render: async () => text }]. call(method, body) is injectable for tests.
export function liveMenu({ token, chatId, title, panels, app = null, log = () => {}, everyMs = 1000, liveMs = LIVE_MS, now = Date.now,
  call = async (method, body) => {
    const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const json = await r.json().catch(() => ({}));
    if (!json.ok) throw Object.assign(Error(`Telegram ${method}: ${json.description || r.status}`), { retryAfter: json.parameters?.retry_after });
    return json.result;
  } }) {
  const s = { messageId: null, panel: panels[0].id, liveUntil: 0, lastText: "", waitUntil: 0, busy: false };

  const keyboard = live => {
    const buttons = panels.map(p => ({ text: p.id === s.panel ? `• ${p.label}` : p.label, callback_data: `menu:${p.id}` }));
    const rows = app && APP_URL ? [[{ text: "Open dashboard", web_app: { url: `${APP_URL}?a=${app}` } }]] : [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([live ? { text: "Pause", callback_data: "menu:pause" } : { text: "Go live", callback_data: "menu:live" }, { text: "Close", callback_data: "menu:close" }]);
    return { inline_keyboard: rows };
  };
  const body = async () => {
    const panel = panels.find(p => p.id === s.panel) || panels[0];
    const text = await panel.render().catch(error => `Could not read this: ${error.message.slice(0, 120)}`);
    const live = now() < s.liveUntil;
    // Escaping can lengthen the text, so cut the raw text until the escaped copy fits Telegram's 4096 characters.
    let raw = String(text).slice(0, 3500), shown = esc(raw);
    while (shown.length > 3600) { raw = raw.slice(0, Math.floor(raw.length * 0.8)); shown = esc(raw); }
    return { live, html: `<b>${esc(title)}: ${esc(panel.label)}</b>\n<pre>${shown}</pre>\n${live ? `Live, every second. ${clock(now())}` : `Paused at ${clock(now())}. Tap Go live.`}` };
  };

  // One line per kind of error a minute, so an outage does not write one every second.
  const logged = new Map();
  const logOnce = message => { if (Date.now() - (logged.get(message) || 0) < 60000) return; logged.set(message, Date.now()); log({ event: "menu_error", error: message }); };

  // Edits the menu message when its text changed. Skips while Telegram asked us to wait.
  async function paint(force = false) {
    if (!s.messageId || s.busy || now() < s.waitUntil) return;
    s.busy = true;
    let text = "";
    try {
      const { live, html } = await body();
      text = html.replace(/\n[^\n]*$/, "");   // the clock line alone is no reason to edit
      if (!force && text === s.lastText) return;
      await call("editMessageText", { chat_id: chatId, message_id: s.messageId, text: html, parse_mode: "HTML", reply_markup: keyboard(live) });
      s.lastText = text;
    } catch (error) {
      if (error.retryAfter) s.waitUntil = now() + error.retryAfter * 1000;
      else if (/not modified/.test(error.message)) s.lastText = text;
      else if (/not found|can't be edited/.test(error.message)) s.messageId = null;
      else logOnce(error.message.slice(0, 160));
    } finally { s.busy = false; }
  }

  let timer = null;
  const tick = () => {
    if (!s.messageId) { clearInterval(timer); timer = null; return; }
    if (now() >= s.liveUntil) { if (s.busy || now() < s.waitUntil) return; clearInterval(timer); timer = null; return paint(true); }   // one last paint says Paused
    return paint();
  };
  const goLive = () => { s.liveUntil = now() + liveMs; if (!timer) timer = setInterval(tick, everyMs); };

  return {
    state: s,
    tick,
    // "/menu" or "menu": a fresh menu message at the bottom of the chat; the old one stops updating.
    isMenu: text => /^\/?(menu|dashboard)$/i.test(String(text || "").trim()),
    async open() {
      if (s.messageId) call("deleteMessage", { chat_id: chatId, message_id: s.messageId }).catch(() => {});   // one live menu at a time
      s.messageId = null;
      s.liveUntil = now() + liveMs;
      const { live, html } = await body();
      const sent = await call("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", reply_markup: keyboard(live) });
      s.messageId = sent.message_id;
      s.lastText = html.replace(/\n[^\n]*$/, "");
      goLive();
    },
    // One button tap. Only the owner's own chat counts; a tap on an older menu message takes it over.
    async handle(q) {
      if (String(q?.message?.chat?.id) !== String(chatId) || !String(q.data || "").startsWith("menu:")) return false;
      await call("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
      const what = q.data.slice(5);
      s.messageId = q.message.message_id;
      if (what === "close") {
        s.liveUntil = 0;
        await call("deleteMessage", { chat_id: chatId, message_id: s.messageId }).catch(() => {});
        s.messageId = null;
        return true;
      }
      if (what === "pause") s.liveUntil = 0;
      else { if (panels.some(p => p.id === what)) s.panel = what; goLive(); }
      await paint(true);
      return true;
    },
  };
}

// The "/" list Telegram shows by the text box, like BotFather's.
export const setCommands = (token, commands) => fetch(`https://api.telegram.org/bot${token}/setMyCommands`, { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ commands: commands.map(([command, description]) => ({ command, description })) }), signal: AbortSignal.timeout(10000) }).catch(() => {});

// A value that is slow to read (a log scan, a health report): returns the last one at once and refreshes in the
// background at most every ms, so a one-second panel never waits on it.
export function cached(read, ms) {
  let value = null, at = 0, pending = null;
  return async () => {
    if (!pending && Date.now() - at >= ms) pending = read().then(v => { value = v; }, e => { value = value ?? { error: e.message }; }).finally(() => { at = Date.now(); pending = null; });
    if (value === null && pending) await pending;
    return value;
  };
}
