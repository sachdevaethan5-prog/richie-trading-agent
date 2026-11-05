// Richie's connection to Robinhood's trading MCP server (https://agent.robinhood.com/mcp/trading).
// Standard MCP sign-in: the client registers itself, you approve once in a browser (PKCE), and
// the refresh token is kept as the secret "robinhood" (src/env.mjs).
// Robinhood only lets an agent trade in your Agentic account, whatever it asks for.
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { secret, saveSecret, DATA_DIR } from "../env.mjs";

export const SERVER = "https://agent.robinhood.com/mcp/trading";
const META = "https://agent.robinhood.com/.well-known/oauth-authorization-server/mcp/trading";
export const REDIRECT = "http://127.0.0.1:8765/callback";

export async function loadAuth() {
  return JSON.parse(await secret("robinhood"));
}
// Robinhood may hand back a new refresh token on every refresh, so it is saved each time.
export const saveAuth = auth => saveSecret("robinhood", JSON.stringify(auth));

const metadata = async () => (await fetch(META, { signal: AbortSignal.timeout(15000) })).json();

// Step 1 of sign-in: register this client and build the link you open.
export async function beginSignIn() {
  const meta = await metadata();
  const reg = await (await fetch(meta.registration_endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ client_name: "Richie (open source trading agent)", redirect_uris: [REDIRECT], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }) })).json();
  if (!reg.client_id) throw new Error(`Robinhood did not register the client: ${JSON.stringify(reg).slice(0, 200)}`);
  const verifier = randomBytes(48).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const url = new URL(meta.authorization_endpoint);
  for (const [k, v] of Object.entries({ response_type: "code", client_id: reg.client_id, redirect_uri: REDIRECT, scope: "internal", state, resource: SERVER,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" })) url.searchParams.set(k, v);
  return { url: url.href, clientId: reg.client_id, verifier, state, tokenEndpoint: meta.token_endpoint };
}

async function tokenRequest(endpoint, form, fetcher = fetch) {
  const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(form), signal: AbortSignal.timeout(20000) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(`Robinhood token ${response.status}: ${body.error_description || body.error || ""}`.trim());
  return body;
}

// SSE or plain JSON, whichever the server answers with; returns the message with this id.
export function parseRpc(contentType, text, id) {
  if (!/event-stream/.test(contentType || "")) return JSON.parse(text);
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try { const msg = JSON.parse(line.slice(5)); if (msg.id === id) return msg; } catch {}
  }
  throw new Error("No answer in the event stream");
}

// Robinhood may rotate the refresh token on each use, so a refresh runs under a lock folder and first re-reads
// the newest saved token. A lock left by a crashed process is cleared after a minute.
export const REFRESH_LOCK = join(DATA_DIR, "robinhood-refresh.lock");
export async function withLock(dir, fn, { waitMs = 30000, staleMs = 60000, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  const start = Date.now();
  for (;;) {
    try { await mkdir(dir); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const age = Date.now() - await stat(dir).then(s => s.mtimeMs, () => Date.now());
      if (age > staleMs) { await rm(dir, { recursive: true, force: true }); continue; }
      if (Date.now() - start > waitMs) throw new Error("Robinhood refresh lock busy");
      await pause(200);
    }
  }
  try { return await fn(); } finally { await rm(dir, { recursive: true, force: true }); }
}

// "client id not allowed: <missing>": five overnight denials (Oct 22 to 30) of tokens Robinhood had just issued,
// each gone by the next check. Logged with phase and token age to find the cause (rh_reply).
const DENIED = /client id not allowed/i;
const TRACE_HEADERS = ["x-request-id", "x-amzn-requestid", "x-amzn-trace-id", "cf-ray", "www-authenticate"];

// The MCP client: initialize once, then tools/list and tools/call; refreshes the token on a 401.
// readOnly(name) says which tools are look-only; only those (and setup) are retried after a denial, never orders.
export async function connect({ readAuth = loadAuth, writeAuth = saveAuth, fetcher = fetch, log = () => {}, lock = REFRESH_LOCK,
  readOnly = () => false, pause = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
  let auth = null, access = null, tokenAt = 0, session = null, id = 0;
  const refresh = () => (lock ? f => withLock(lock, f) : f => f())(async () => {
    auth = await readAuth();   // the newest refresh token, which the other process may have rotated
    const t = await tokenRequest(auth.tokenEndpoint, { grant_type: "refresh_token", refresh_token: auth.refresh, client_id: auth.clientId, resource: SERVER }, fetcher);
    access = t.access_token; tokenAt = Date.now();
    const rotated = Boolean(t.refresh_token && t.refresh_token !== auth.refresh);
    if (rotated) { auth = { ...auth, refresh: t.refresh_token }; await writeAuth(auth); }
    await log({ event: "rh_refresh", rotated, expiresIn: t.expires_in ?? null });
  });
  const post = async (body, tries = {}) => {
    if (!access) await refresh();
    const response = await fetcher(SERVER, { method: "POST", signal: AbortSignal.timeout(60000),
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${access}`, ...(session ? { "Mcp-Session-Id": session } : {}) },
      body: JSON.stringify(body) });
    session = response.headers.get("mcp-session-id") || session;
    const text = await response.text();
    if (response.ok) return body.id === undefined ? null : parseRpc(response.headers.get("content-type"), text, body.id);
    const phase = body.method === "tools/call" ? body.params?.name : body.method;
    const trace = Object.fromEntries(TRACE_HEADERS.map(h => [h, response.headers.get(h)]).filter(([, v]) => v));
    await log({ event: "rh_reply", phase, status: response.status, tokenAgeMs: Date.now() - tokenAt, tries: Object.keys(tries), ...trace, text: text.slice(0, 120) });
    // A denial of a just-issued token: wait and send the same request once more with the same token, but only for
    // setup and look-only tools. An order is never resent here.
    const safe = body.method !== "tools/call" || readOnly(phase);
    if ([401, 403].includes(response.status) && DENIED.test(text) && safe && !tries.waited) { await pause(15000); return post(body, { ...tries, waited: true }); }
    if (response.status === 401 && !tries.fresh) { access = null; return post(body, { ...tries, fresh: true }); }
    // Then a new token, for setup only.
    if (response.status === 403 && body.method === "initialize" && DENIED.test(text) && !tries.fresh) {
      access = null; session = null;
      return post(body, { ...tries, fresh: true });
    }
    throw new Error(`Robinhood MCP ${response.status}: ${text.slice(0, 200)}`);
  };
  const rpc = async (method, params) => {
    const msg = await post({ jsonrpc: "2.0", id: ++id, method, params });
    if (msg.error) throw new Error(`Robinhood: ${msg.error.message || JSON.stringify(msg.error)}`);
    return msg.result;
  };
  await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "richie", version: "1.0" } });
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  return {
    tools: async () => (await rpc("tools/list", {})).tools || [],
    call: async (name, args) => {
      const result = await rpc("tools/call", { name, arguments: args || {} });
      const text = (result.content || []).map(c => c.text ?? "").join("\n");
      if (result.isError) throw new Error(text.slice(0, 500) || "Robinhood tool error");
      return text;
    },
  };
}
