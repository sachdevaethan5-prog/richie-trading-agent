// Richie's connection to Kalshi (event contracts).
// Plain REST, every request signed with your own Kalshi API key: the timestamp, method and path (no query)
// signed with the private key, RSA-PSS SHA-256 or Ed25519 (docs.kalshi.com, "API keys").
// Key id and private key are stored as one secret, "kalshi" (src/env.mjs), saved once with:
//   node src/core/kalshi.mjs --save <key id> <path to the .key file>
import { secret, saveSecret } from "../env.mjs";
import { readFile } from "node:fs/promises";
import { createPrivateKey, sign, constants } from "node:crypto";

const BASE = process.env.RICHIE_KALSHI_BASE || "https://api.elections.kalshi.com/trade-api/v2";

export function signature(pem, timestamp, method, path) {
  const key = createPrivateKey(pem);
  const message = Buffer.from(`${timestamp}${method}${path.split("?")[0]}`);
  const signed = key.asymmetricKeyType === "ed25519" ? sign(null, message, key)
    : sign("sha256", message, { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: constants.RSA_PSS_SALTLEN_DIGEST });
  return signed.toString("base64");
}

// Stored as one base64 line: the Keychain hands back a multi-line value as hex.
const loadKey = async () => JSON.parse(Buffer.from(await secret("kalshi"), "base64").toString());

export async function connect() {
  const { keyId, pem } = await loadKey();
  const prefix = new URL(BASE).pathname;   // /trade-api/v2, part of the signed path
  const call = async (method, path, body) => {
    const timestamp = String(Date.now());
    const response = await fetch(BASE + path, { method, signal: AbortSignal.timeout(30000),
      headers: { "Content-Type": "application/json", "KALSHI-ACCESS-KEY": keyId, "KALSHI-ACCESS-TIMESTAMP": timestamp, "KALSHI-ACCESS-SIGNATURE": signature(pem, timestamp, method, prefix + path) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    if (!response.ok) throw new Error(`Kalshi ${response.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : {};
  };
  // put and delete are for parlay quotes only (accepting one, closing Richie's own stale requests).
  return { get: path => call("GET", path), post: (path, body) => call("POST", path, body), put: (path, body) => call("PUT", path, body), delete: path => call("DELETE", path) };
}

if (process.argv[2] === "--save") {
  const [keyId, file] = process.argv.slice(3);
  if (!keyId || !file) { console.error("node src/core/kalshi.mjs --save <key id> <path to the .key file>"); process.exit(1); }
  const pem = await readFile(file, "utf8");
  createPrivateKey(pem);   // fails here on a bad file, not at the first trade
  await saveSecret("kalshi", Buffer.from(JSON.stringify({ keyId, pem })).toString("base64"));
  const { balance_dollars } = await (await connect()).get("/portfolio/balance");
  console.log(`Saved. Kalshi answered: balance $${balance_dollars}. You can delete ${file} now.`);
}
