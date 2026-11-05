// Richie's live Telegram menu panels (shared/tg-menu.mjs): what he is doing now, the health of his
// parts, and a small copy of his dashboard. Everything is read from the ledger, nothing is called at a broker.
import { statusText } from "./live.mjs";
import { protectionState } from "./monitor.mjs";
import { kalshiCalibration } from "./sessions.mjs";
import { scoreboard } from "./core/lib.mjs";

const ago = (at, now) => { if (!at) return "never"; const s = Math.max(0, (now - at) / 1000); return s < 90 ? `${Math.round(s)}s ago` : s < 5400 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`; };
const clip = (t, n) => String(t || "").replace(/\s+/g, " ").slice(0, n);

// A job is running when it started after it last finished.
export const runningJobs = (jobs, now) => jobs.filter(j => j.last_started_at && j.last_started_at > Math.max(j.last_ok_at || 0, j.last_error_at || 0))
  .map(j => `${j.name}, for ${ago(j.last_started_at, now).replace(" ago", "")}`);

// The same, as data, for the dashboard (agent/agents-app.mjs); live.mjs writes it every second.
export function richieLive(ledger, at = Date.now()) {
  const jobs = ledger.jobs();
  let month = null; try { month = JSON.parse(ledger.meta("month") || "null"); } catch {}
  return {
    paused: ledger.meta("paused") === "1",
    running: jobs.filter(j => j.last_started_at && j.last_started_at > Math.max(j.last_ok_at || 0, j.last_error_at || 0)).map(j => ({ name: j.name, since: j.last_started_at })),
    failing: jobs.filter(j => j.last_error_at && j.last_error_at > (j.last_ok_at || 0)).map(j => ({ name: j.name, error_class: j.error_class, at: j.last_error_at })),
    health: ledger.health().map(h => ({ component: h.component, status: h.status, last_ok_at: h.last_ok_at, last_error_at: h.last_error_at, error_class: h.error_class })),
    accounts: ledger.accounts().map(a => ({ broker: a.broker, value: a.value, cash: a.cash })),
    positions: ledger.positions("open").map(p => ({ instrument: p.instrument, quantity: Number(p.quantity.toFixed(6)), broker: p.broker, state: protectionState(p, at).state })),
    events: ledger.events(10).map(e => ({ at: e.at, kind: e.kind, text: String(e.text).slice(0, 300) })),
    scoreboard: scoreboard(ledger.trades(false)).line, paper: scoreboard(ledger.trades(true)).line, calibration: kalshiCalibration(ledger).line,
    month: month?.now && month.start?.value > 0 ? { account: month.now.value / month.start.value - 1, spy: month.now.spy / month.start.spy - 1,
      since: new Date(month.start.at).toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" }) } : null,
  };
}

export function richiePanels(ledger, { now = Date.now } = {}) {
  return [
    { id: "now", label: "Current task", render: async () => {
      const at = now(), running = runningJobs(ledger.jobs(), at);
      return [running.length ? `Running:\n${running.map(r => `  - ${r}`).join("\n")}` : "Idle between jobs.",
        ledger.meta("paused") === "1" ? "Paused: no new buys; exits still run." : "",
        "Latest:", ...ledger.events(6).map(e => `  ${ago(e.at, at).padEnd(8)} ${clip(e.text, 90)}`)].filter(Boolean).join("\n");
    } },
    { id: "health", label: "Health", render: async () => {
      const at = now();
      const parts = ledger.health().map(h => `${h.status === "ok" ? "ok  " : "BAD "} ${h.component.padEnd(22)} ${h.status === "ok" ? ago(h.last_ok_at, at) : `${h.error_class || h.status}, ${ago(h.last_error_at, at)}`}`);
      const late = ledger.jobs().filter(j => j.last_error_at && j.last_error_at > (j.last_ok_at || 0)).map(j => `  ${j.name}: ${j.error_class || "error"} ${ago(j.last_error_at, at)}`);
      return [...parts, late.length ? `Jobs failing:\n${late.join("\n")}` : "All jobs last ran fine."].join("\n");
    } },
    { id: "board", label: "Dashboard", render: async () => {
      const at = now();
      const open = ledger.positions("open").map(p => `  ${p.instrument.slice(0, 26).padEnd(26)} ${Number(p.quantity.toFixed(4))}`);
      return [statusText(ledger, at).replace(/\. /g, ".\n"), open.length ? `Open positions:\n${open.join("\n")}` : ""].filter(Boolean).join("\n");
    } },
  ];
}
