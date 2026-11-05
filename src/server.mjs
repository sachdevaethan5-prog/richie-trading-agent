#!/usr/bin/env node
// Dashboard server. Loopback only, same-origin, no keys. Reads the ledger read-only;
// its one write is a request added to the controls inbox (controls.mjs, CONTROLS.md), which live Richie acts on.
//   node src/server.mjs                     fixture data (labeled sample), http://127.0.0.1:8792
//   node src/server.mjs --ledger FILE       an existing rebuild ledger, opened read-only
//   --port N                                           another port (default 8792)
//   --public-host NAME                                 also answer NAME, only with Cloudflare's Access header (optional, for remote access behind Cloudflare Access)
//   --controls FILE --control-email EMAIL              accept control requests into the inbox FILE (public host: that Access email only)
// It never opens the legacy state.json or journals and never imports a broker module.
// Remote access is Cloudflare Access in front of the tunnel, which checks the Access token itself.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { snapshot, positionDetail, CONTRACT } from "./snapshot.mjs";
import { openLedger } from "./ledger.mjs";
import { EXECUTION_MODE } from "./config.mjs";
import { openInbox, parseRequest, MAX_PER_MINUTE } from "./controls.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const HOST = "127.0.0.1";

// hosts: the Host headers answered (others get 421, which also stops DNS-rebinding pages in a browser on this machine).
// accessHosts: public hostnames that are only reached through Cloudflare Access; a request for one without
// Cloudflare's signed Access header is refused. The signature itself is checked by cloudflared (access: required).
// controls: { inbox, email } or null (no control endpoint at all).
export function handler({ source, hosts = null, accessHosts = [], controls = null, now = Date.now }) {
  const page = readFile(join(HERE, "dashboard/index.html"), "utf8");
  const headers = { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "Cache-Control": "no-store", "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-origin", "Cross-Origin-Opener-Policy": "same-origin", "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" };
  const send = (res, status, type, body) => { res.writeHead(status, { ...headers, "Content-Type": type }); res.end(body); };
  const json = (res, status, body) => send(res, status, "application/json; charset=utf-8", JSON.stringify(body));
  return async (req, res) => {
    const host = String(req.headers.host || "").toLowerCase();
    if (hosts && !hosts.includes(host)) return json(res, 421, { error: "Unknown host" });
    if (accessHosts.includes(host) && !req.headers["cf-access-jwt-assertion"]) return json(res, 403, { error: "Sign in through Cloudflare Access" });
    if (controls && req.method === "POST" && req.url === "/api/control") return control(req, res, host);
    if (req.method !== "GET" && req.method !== "HEAD") { res.setHeader("Allow", "GET, HEAD"); return json(res, 405, { error: "Read-only: GET only" }); }
    if (req.url.length > 300) return json(res, 414, { error: "Address too long" });
    const url = new URL(req.url, `http://${HOST}`);
    try {
      if (url.pathname === "/" || url.pathname === "/index.html") return send(res, 200, "text/html; charset=utf-8", await page);
      if (url.pathname === "/api/controls") return controls ? json(res, 200, { enabled: true, log: controls.inbox.recent(20).map(r => ({ ...r, args: JSON.parse(r.args) })) }) : json(res, 404, { error: "Controls are off" });
      const m = url.pathname.match(/^\/api\/positions\/(.+)$/);
      if (url.pathname !== "/api/snapshot" && !m) return json(res, 404, { error: "Not found" });
      const { ledger, strategy, now, close } = await source();
      try {
        // Live when live.mjs holds the execution lease; the strategy summary is what it last saved in the ledger.
        const lease = ledger.get("SELECT expires_at FROM leases WHERE name = 'execution'");
        const mode = lease && lease.expires_at > now ? "live" : EXECUTION_MODE;
        let saved = null; try { saved = JSON.parse(ledger.meta("strategy") || "null"); } catch { saved = null; }
        if (!m) return json(res, 200, snapshot(ledger, { now, mode, strategy: strategy ?? saved }));
        const p = positionDetail(ledger, decodeURIComponent(m[1]), { now });
        return p ? json(res, 200, { contract: CONTRACT, generatedAt: now, position: p }) : json(res, 404, { error: "No such position" });
      } finally { close?.(); }
    } catch (error) {
      // The page shows this as "unavailable"; it never falls back to sample numbers.
      return json(res, 503, { contract: CONTRACT, error: "Ledger unavailable", errorClass: error.code || error.name || "Error" });
    }
  };

  // A control request. Another site cannot send the custom header without a CORS preflight, which this server
  // never answers, and the Origin must be this host's own; on the public host only the owner's Access email is taken.
  async function control(req, res, host) {
    const isPublic = accessHosts.includes(host);
    if (req.headers["x-richie-control"] !== "1") return json(res, 403, { error: "Missing the control header" });
    if (req.headers.origin !== `${isPublic ? "https" : "http"}://${host}`) return json(res, 403, { error: "Wrong origin" });
    const email = String(req.headers["cf-access-authenticated-user-email"] || "").toLowerCase();
    if (isPublic && (!controls.email || email !== controls.email.toLowerCase())) return json(res, 403, { error: `Controls are not allowed for ${email || "this sign-in"}` });
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return json(res, 415, { error: "JSON only" });
    let raw = "";
    for await (const chunk of req) { raw += chunk; if (raw.length > 2048) return json(res, 413, { error: "Request too large" }); }
    let body; try { body = JSON.parse(raw); } catch { return json(res, 400, { error: "Not JSON" }); }
    const { problem, request } = parseRequest(body);
    if (problem) return json(res, 400, { error: problem });
    if (controls.inbox.has(request.id)) return json(res, 409, { error: "Already received" });
    if (controls.inbox.countSince(now() - 60000) >= MAX_PER_MINUTE) return json(res, 429, { error: "Too many controls this minute" });
    controls.inbox.add({ ...request, email: email || null, via: isPublic ? host : "local", at: now() });
    return json(res, 202, { id: request.id, status: "pending" });
  }
}

async function main() {
  const args = process.argv.slice(2), arg = name => args.includes(name) ? args[args.indexOf(name) + 1] : null;
  const port = Number(arg("--port") || 8792), file = arg("--ledger"), publicHost = arg("--public-host"), inboxFile = arg("--controls");
  let source;
  if (file) source = async () => { const ledger = openLedger(file, { readOnly: true }); return { ledger, strategy: null, now: Date.now(), close: () => ledger.close() }; };
  else {
    // Fixture times are relative to when the demo started, so their ages keep growing honestly.
    const { demoLedger } = await import("./fixtures/demo.mjs");
    const demo = await demoLedger(Date.now());
    source = async () => ({ ...demo, now: Date.now() });
  }
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(publicHost ? [publicHost.toLowerCase()] : [])];
  const server = createServer({ maxHeaderSize: 16384 }, handler({ source, hosts, accessHosts: publicHost ? [publicHost.toLowerCase()] : [],
    controls: inboxFile ? { inbox: openInbox(inboxFile), email: arg("--control-email") } : null }));
  server.headersTimeout = 10000; server.requestTimeout = 15000;
  server.listen(port, HOST, () => console.log(`Richie dashboard (${file ? "ledger, read-only" : "fixture data"}${inboxFile ? ", controls on" : ""}): http://${HOST}:${port}`));
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
