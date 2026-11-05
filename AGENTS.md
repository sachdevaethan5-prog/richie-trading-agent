# Setting up Richie: instructions for a coding agent

You are helping a person set up Richie, a trading agent that places real orders with their money. Follow these steps
in order. Read README.md first for what Richie is.

## Rules for you, the agent

- **Never place a trade.** Do not run `npm start`, `node src/live.mjs --live` or `node src/parlay-check.mjs --buy`
  yourself. Tell the person the command and let them run it.
- **Never handle secrets in chat.** Do not ask the person to paste a key, token or password into the conversation, and
  do not print one. Have them type secrets into `.env` themselves, or run `node src/setup.mjs <name>` in their own
  terminal (it hides input). You may read whether a secret exists with `npm run check`, which never prints values.
- **Never sign in for them.** Robinhood and Kalshi sign-ins, key creation and funding are done by the person in their
  own browser and apps.
- **Never commit or push** `.env`, keys, `~/.richie`, ledgers, journals or logs.
- **Ask before** changing `src/playbook.md`, `src/config.mjs` or any gate or limit in `src/core/lib.mjs`.
- Stop and ask whenever a step fails in a way this file does not cover.

## Steps

1. **Node.** Run `node --version`. It must be v22.12 or newer. If not, help them install a current Node 22 LTS or newer
   (nvm, fnm, Homebrew, or the installer from nodejs.org), then check again.
2. **Tests.** Run `npm test`. Every test must pass. They are offline and use fake brokers. If any fail, stop and
   report the failure.
3. **Demo.** Run `npm run demo` in the background, confirm http://127.0.0.1:8792 answers (for example
   `curl -s http://127.0.0.1:8792/api/snapshot | head -c 200`), tell the person to open it in a browser, then stop it.
4. **Settings file.** Run `cp .env.example .env` if `.env` does not exist. Ask which brokers they want: Robinhood,
   Kalshi or both. If Robinhood, ask how much of that account Richie should trade himself, from 0 to 100% (the rest
   is held in SPY by code and never sold to fund a trade). Tell them the default is 20%, that in the long-history test
   every share trailed simply holding SPY and a bigger share trailed by more (20%: 0.1 to 1.3 points a year; 65%: 0.7 to
   4.7 points a year since 2015), and that 100% means no SPY at all. They set `RICHIE_TRADING_PERCENT` in `.env`
   themselves; `npm run check` shows the split.
5. **OpenRouter.** Tell them to create a key at https://openrouter.ai/keys, add credit, and put it in
   `RICHIE_OPENROUTER` in `.env` themselves.
6. **Telegram.** Walk them through README step 5: @BotFather `/newbot` for `RICHIE_TELEGRAM_TOKEN`, then message the
   bot and read the chat id from `https://api.telegram.org/bot<token>/getUpdates` for `RICHIE_TELEGRAM_CHAT_ID`. They
   enter both in `.env`.
7. **Robinhood (if chosen).** They set up an Agentic account for an external agent in the Robinhood app, then run
   `npm run signin` in their own terminal and approve in the browser.
8. **Kalshi (if chosen).** They create an API key in Kalshi (Account, API keys) and run
   `node src/core/kalshi.mjs --save <key id> <path to .key file>`. It prints their balance when it works. Remind them to
   delete the `.key` file afterwards.
9. **Check.** Run `npm run check`. `openrouter`, `telegram-token` and `telegram-chat-id` must say found, plus
   `robinhood` and/or `kalshi` for the brokers they chose.
10. **Watch-only run.** Run `npm run watch`. It reads the brokers and prints a JSON summary without trading. Show them
    the account values and any errors. Errors with class `auth` mean a sign-in or key step needs redoing.
11. **Playbook.** Show them `src/playbook.md` and the Disclaimer section of README.md. Ask whether they want to change
    the strategy before going live. Edit only what they ask for, then run `npm test` again.
12. **Hand over.** Tell them how to go live and how to stop:
    - Start trading: `npm start` (keep it running in a terminal, tmux, launchd or systemd).
    - Dashboard: `npm run dashboard`, then http://127.0.0.1:8792.
    - Stop new buys at any time: send `pause` to the bot, or press Pause on the dashboard.
    - Only one trading process may run at a time. The ledger lease enforces it.

## Useful facts

- Data lives in `~/.richie` (or `$RICHIE_HOME`): `ledger.db`, `journal.md`, `lessons.md`, `logs/richie.log`,
  `controls/`, `backups/`.
- Logs are JSON lines. `tail -f ~/.richie/logs/richie.log` shows what Richie is doing.
- Session times are US Eastern and set in `src/live-sessions.mjs` (`sessionDue`).
- `npm test` must stay green after any change.
