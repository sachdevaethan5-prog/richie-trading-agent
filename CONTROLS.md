# Dashboard controls

The dashboard (`npm run dashboard`, http://127.0.0.1:8792) has three kinds of buttons.

| Button | Where | What happens | Moves money |
| --- | --- | --- | --- |
| Pause / Resume | top bar | Same as the Telegram `pause` and `resume`: stops or allows new buys. Exits keep running. | No |
| Run session now | top bar, one each for stocks and Kalshi | Same as Telegram `run` and `kalshi`: a session starts at once under every usual check. | Only through the session's own checked proposals, plus a few cents of model use |
| Sell now | each open position | Sells the whole position, or a chosen part, the same way a stop exit does: stocks at market, Kalshi at the bid. | Yes, a sale only |

Left out on purpose:
- **Buying.** A buy needs a written case, the entry gates and the review model's PASS. A button cannot supply those.
  To buy, run a session.
- **Cancelling orders.** Richie never calls Robinhood's cancel tool, and Kalshi orders never rest (they fill at once
  or cancel), so there is nothing to cancel.
- **Changing rules, gates, settings or the playbook.** Never from a web page.

## How a click reaches Richie

The dashboard server keeps no keys and never trades. It only drops a request in an inbox; live Richie picks it up,
checks it and acts through the same code Telegram commands and exits use.

1. The page shows a confirm box with the exact action, for example "Sell 0.059 XLE at market, about $3.98".
   The second click sends it.
2. The server checks the request (below) and writes one row to `~/.richie/controls/inbox.db`. On macOS,
   `scripts/dashboard.sh` runs the server in a sandbox where that folder is the only place it may write, with no
   Keychain and no internet.
3. Live Richie reads the inbox every 5 seconds, checks the request again, and runs it: pause and resume as commands,
   sessions as sessions, sales through `submitOrder()` like any exit (lease, unresolved-order block, policy, durable
   intent, then the broker).
4. The result goes back to the inbox row, the activity timeline and Telegram, so every action shows on your phone.

## Who can press a button

- The server listens on 127.0.0.1 only and accepts a control only on POST, with the page's own `Origin` and a custom
  `X-Richie-Control` header. Another website cannot send that header without the browser asking first, and the
  server refuses that question.
- Optional remote access: `src/server.mjs --public-host NAME --control-email EMAIL` answers NAME only with Cloudflare
  Access headers and takes controls only from that Access email. Put real authentication in front before you expose it.
- Live Richie refuses a request older than 60 seconds, one it has seen before, an unknown kind, a sale larger than
  the holding, more than one pending sale per position, and more than 10 requests a minute.

Every request, accepted or refused, is kept in the inbox and shown on the dashboard as "Control log".
`RICHIE_CONTROLS=off` turns all controls off.
