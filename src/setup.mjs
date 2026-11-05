#!/usr/bin/env node
// Saves one secret where Richie looks for it (src/env.mjs): the macOS Keychain on a Mac, else a private file in
// $RICHIE_HOME/secrets. Paste the value when asked; it is not echoed.
//   node src/setup.mjs openrouter          OpenRouter API key
//   node src/setup.mjs telegram-token      Telegram bot token from @BotFather
//   node src/setup.mjs telegram-chat-id    your own Telegram chat id (Richie answers only this chat)
//   node src/setup.mjs check               shows which secrets are found, never their values
// Robinhood: node src/signin.mjs. Kalshi: node src/core/kalshi.mjs --save <key id> <path to the .key file>.
import { createInterface } from "node:readline";
import { secret, saveSecret, DATA_DIR } from "./env.mjs";

const NAMES = ["openrouter", "telegram-token", "telegram-chat-id", "robinhood", "kalshi"];
const name = process.argv[2];

if (!name || name === "check") {
  console.log(`Data folder: ${DATA_DIR}`);
  for (const n of NAMES) console.log(`${n.padEnd(18)} ${await secret(n).then(() => "found", () => "missing")}`);
  process.exit(0);
}
if (!["openrouter", "telegram-token", "telegram-chat-id"].includes(name)) {
  console.error(`Unknown secret "${name}". Use openrouter, telegram-token, telegram-chat-id or check.`);
  process.exit(1);
}
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
rl._writeToOutput = s => { if (!s.includes("\n")) return; rl.output.write("\n"); };   // hide what is typed
process.stdout.write(`Paste the value for ${name}, then press Enter: `);
rl.once("line", async value => {
  rl.close();
  if (!value.trim()) { console.error("Nothing saved: the value was empty."); process.exit(1); }
  console.log(`Saved to ${await saveSecret(name, value.trim())}.`);
});
