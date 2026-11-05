#!/usr/bin/env node
// Robinhood sign-in for Richie. Registers a client with Robinhood's agentic MCP server and saves the refresh token
// as the secret "robinhood" (src/env.mjs).
//   node src/signin.mjs
// It opens Robinhood's approval page; the approval comes back on 127.0.0.1:8765. Approved on another device? Paste
// the address the page ended on and press Enter.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { secret, saveSecret, DATA_DIR } from "./env.mjs";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { beginSignIn, connect, REDIRECT, SERVER } from "./core/robinhood.mjs";

export const RUNNER_LOCK = join(DATA_DIR, "robinhood-refresh.lock");
export const loadRunnerAuth = async () => JSON.parse(await secret("robinhood"));
export const saveRunnerAuth = auth => saveSecret("robinhood", JSON.stringify(auth));
// The runner's connection: its own sign-in and its own refresh lock.
export const runnerConnect = opts => connect({ ...opts, readAuth: loadRunnerAuth, writeAuth: saveRunnerAuth, lock: RUNNER_LOCK });

async function main() {
  const start = await beginSignIn();
  console.log(`\nApprove Richie on Robinhood. Opening:\n${start.url}\n`);
  execFile(process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open", [start.url], () => {});
  const code = await new Promise((resolve, reject) => {
    const take = href => {
      const url = new URL(href, REDIRECT);
      if (url.searchParams.get("state") !== start.state) return reject(Error("The sign-in did not match (state). Run it again."));
      if (url.searchParams.get("error")) return reject(Error(`Robinhood said: ${url.searchParams.get("error_description") || url.searchParams.get("error")}`));
      resolve(url.searchParams.get("code"));
    };
    const server = createServer((req, res) => {
      if (!req.url.startsWith("/callback")) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": "text/plain" }).end("Richie is signed in to Robinhood. You can close this tab.");
      server.close();
      take(req.url);
    }).listen(8765, "127.0.0.1");
    const rl = createInterface({ input: process.stdin });
    console.log("Waiting for the approval... (approved on another device? paste the address it ended on, then Enter)");
    rl.on("line", line => { if (line.includes("code=")) { rl.close(); server.close(); take(line.trim()); } });
  });
  const response = await fetch(start.tokenEndpoint, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(20000),
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: start.clientId, code_verifier: start.verifier, resource: SERVER }) });
  const t = await response.json().catch(() => ({}));
  if (!response.ok || !t.refresh_token) throw Error(`Robinhood token ${response.status}: ${t.error_description || t.error || "no refresh token"}`);
  await saveRunnerAuth({ clientId: start.clientId, tokenEndpoint: start.tokenEndpoint, refresh: t.refresh_token });
  const rh = await runnerConnect();
  console.log(`\nSigned in with its own client. Robinhood answered with ${(await rh.tools()).length} tools. Restart Richie to use it.`);
  process.exit(0);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exit(1); });
