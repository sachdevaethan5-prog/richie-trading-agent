// Telegram send and receive with delivery records. The legacy tell() swallowed send
// failures and never checked Telegram's "ok" field, so a dropped trade message looked sent. Here every outgoing
// message is a ledger row that ends "delivered" (with Telegram's message id) or "failed" (with the error class).
import { telegramText } from "./voice.mjs";
import { errorClass, withRetry } from "./health.mjs";

// call(method, body) is the HTTP transport; it returns Telegram's parsed JSON or throws. Tests pass a fake.
export function telegramTransport({ token, fetcher = fetch, timeoutMs = 15000 }) {
  return async (method, body, ms = timeoutMs) => {
    const response = await fetcher(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
    const json = await response.json().catch(() => { throw Error(`Telegram ${response.status}: malformed response`); });
    if (!json.ok) throw Object.assign(Error(`Telegram ${json.error_code || response.status}: ${json.description || "not ok"}`), { telegram: json });
    return json.result;
  };
}

export function telegramClient({ call, chatId, ledger, now = Date.now, sleep }) {
  return {
    // Returns { delivered, id } and never claims delivery it did not get. A retry after a timeout can repeat a
    // message Telegram did deliver; a duplicate alert is the lesser problem than a lost one.
    async send(text, kind = "message") {
      const body = telegramText(text).slice(0, 4000);
      const id = ledger.notification(kind, body, now());
      let attempts = 0;
      try {
        const result = await withRetry(() => { attempts++; return call("sendMessage", { chat_id: chatId, text: body }); }, { sleep });
        ledger.notificationResult(id, { status: "delivered", attempts, detail: `message ${result?.message_id ?? "?"}`, at: now() });
        ledger.healthOk("telegram_send", now());
        return { delivered: true, id };
      } catch (error) {
        const cls = errorClass(error);
        ledger.notificationResult(id, { status: "failed", attempts, errorClass: cls, detail: String(error.message).slice(0, 160), at: now() });
        ledger.healthError("telegram_send", cls, now(), "message not delivered");
        return { delivered: false, id, error: cls };
      }
    },
    // One long poll. A failure marks receive health degraded; the caller backs off with backoff(attempt).
    async receive(offset, timeout = 25) {
      try {
        const updates = await call("getUpdates", { offset, timeout, allowed_updates: ["message", "callback_query"] }, (timeout + 15) * 1000);
        ledger.healthOk("telegram_receive", now());
        return { ok: true, updates: updates || [] };
      } catch (error) {
        ledger.healthError("telegram_receive", errorClass(error), now(), "updates may be delayed");
        return { ok: false, updates: [], error: errorClass(error) };
      }
    },
  };
}
