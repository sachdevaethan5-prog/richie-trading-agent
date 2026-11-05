// Component health and bounded retry. Nothing here turns an error into a
// reassuring value: a failed read is "unavailable", an old one is "stale", and both say why.
import { SETTINGS } from "./config.mjs";

// A safe category for an error. The raw message stays in the log; only the class is shown or stored.
export function errorClass(error) {
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || error || ""}`;
  if (/client id not allowed|\b40[13]\b|unauthori[sz]ed|forbidden|invalid_grant/i.test(text)) return "auth";
  if (/\b429\b|rate.?limit|too many requests/i.test(text)) return "rate_limit";
  if (/\b5\d\d\b/.test(text)) return "server";
  if (/timeout|timed out|AbortError|TimeoutError/i.test(text)) return "timeout";
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|ENETUNREACH|socket|network/i.test(text)) return "network";
  if (/JSON|Unexpected token|invalid .*response|malformed/i.test(text)) return "malformed";
  if (/EACCES|EPERM|ENOSPC|EROFS|SQLITE|disk/i.test(text)) return "storage";
  return "unknown";
}
const RETRYABLE = new Set(["network", "timeout", "server", "rate_limit"]);
export const retryable = cls => RETRYABLE.has(cls);

// Exponential backoff with full jitter, never tighter than base and never longer than max.
export function backoff(attempt, { baseMs = SETTINGS.retry.baseMs, maxMs = SETTINGS.retry.maxMs, random = Math.random } = {}) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.max(baseMs, Math.round(ceiling * random()));
}

// Retries reads only. Auth, malformed and storage failures stop at once: retrying them hides the problem.
export async function withRetry(fn, { attempts = SETTINGS.retry.attempts, sleep = ms => new Promise(r => setTimeout(r, ms)), random } = {}) {
  let last;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await fn(attempt); }
    catch (error) {
      last = error;
      if (!retryable(errorClass(error)) || attempt === attempts - 1) break;
      await sleep(backoff(attempt, { random }));
    }
  }
  throw last;
}

// live: read within maxAge. stale: read once, too old now. unavailable: never read, or the last try failed
// after the last success. sample: fixture data, never shown as live.
export function freshness({ asOf, lastErrorAt, sample = false }, maxAgeMs, now = Date.now()) {
  if (sample) return "sample";
  if (!Number.isFinite(asOf)) return "unavailable";
  if (Number.isFinite(lastErrorAt) && lastErrorAt > asOf && now - asOf > maxAgeMs) return "unavailable";
  return now - asOf <= maxAgeMs ? "live" : "stale";
}
