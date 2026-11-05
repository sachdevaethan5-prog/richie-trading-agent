// Where Richie keeps his data and how he reads his secrets. Everything is configurable with environment variables
// (see .env.example). Nothing here is ever sent anywhere.
//
// Secrets are looked up in this order:
//   1. an environment variable, RICHIE_<NAME> (for example RICHIE_TELEGRAM_TOKEN)
//   2. the macOS Keychain, account "richie", service "richie-<name>" (macOS only)
//   3. a file in $RICHIE_HOME/secrets/<name>, readable only by you (any OS)
// Secrets that Richie rotates himself (the Robinhood sign-in) are saved to the Keychain on macOS, else to that file.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";

const run = promisify(execFile);

export const DATA_DIR = process.env.RICHIE_HOME || join(homedir(), ".richie");
export const LOG_FILE = process.env.RICHIE_LOG || join(DATA_DIR, "logs", "richie.log");
export const LEDGER_FILE = join(DATA_DIR, "ledger.db");

const KEYCHAIN_ACCOUNT = "richie";
const useKeychain = () => platform() === "darwin" && process.env.RICHIE_KEYCHAIN !== "off";
const envName = name => `RICHIE_${String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;
const secretFile = name => join(DATA_DIR, "secrets", name);

export async function secret(name) {
  const fromEnv = process.env[envName(name)];
  if (fromEnv) return fromEnv.trim();
  if (useKeychain()) {
    const r = await run("/usr/bin/security", ["find-generic-password", "-a", KEYCHAIN_ACCOUNT, "-s", `richie-${name}`, "-w"], { timeout: 5000 }).catch(() => null);
    if (r?.stdout.trim()) return r.stdout.trim();
  }
  const fromFile = (await readFile(secretFile(name), "utf8").catch(() => "")).trim();
  if (fromFile) return fromFile;
  throw Error(`Missing secret "${name}": set ${envName(name)}, or save it with: node src/setup.mjs ${name}`);
}

export async function saveSecret(name, value) {
  if (useKeychain()) {
    await run("/usr/bin/security", ["add-generic-password", "-U", "-a", KEYCHAIN_ACCOUNT, "-s", `richie-${name}`, "-w", String(value)], { timeout: 5000 });
    return `macOS Keychain (richie-${name})`;
  }
  await mkdir(join(DATA_DIR, "secrets"), { recursive: true, mode: 0o700 });
  await writeFile(secretFile(name), String(value), { mode: 0o600 });
  await chmod(secretFile(name), 0o600);
  return secretFile(name);
}
