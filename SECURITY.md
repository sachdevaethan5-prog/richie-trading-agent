# Security

Richie places real orders with real money, so security problems matter here.

## Reporting a problem

Please do not open a public issue for a security problem. Use GitHub's private vulnerability reporting
("Report a vulnerability" under the Security tab of this repository). Include what you found, how to reproduce it,
and what it could let someone do. This is a personal project, so replies may take a few days.

## Keep your own keys safe

- Never paste API keys, tokens, account numbers, chat ids or log files containing them into an issue, pull request
  or discussion. If you post one by mistake, revoke it at the provider right away: deleting the post is not enough.
- Secrets stay on your machine: in environment variables, a `.env` file (ignored by git), the macOS Keychain, or
  `~/.richie/secrets` with owner-only permissions. Richie never sends them anywhere except to the service they are for.
- The dashboard listens on 127.0.0.1 only. If you expose it to the internet, put real authentication in front of it
  (for example Cloudflare Access); its Sell button moves money.
