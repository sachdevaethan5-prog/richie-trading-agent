---
name: kalshi-parlays
description: Richie only. Read before building, quoting or buying any Kalshi parlay (a combo of 2 or more legs). How to pick NFL legs, price each one from the market, join them for correlation, and decide whether a combo quote is worth buying.
---

# Kalshi parlays (NFL)

Strategy credit: [Tyler Bien](https://www.linkedin.com/in/tylerbien/), for his in-depth work on this parlay method.

Parlays are traded live in Kalshi sessions. Pass is a normal and often correct result. Never promise a win or call a bet safe.

## How a Kalshi parlay works
- A parlay is a combo market in collection KXMVECROSSCATEGORY-R. It pays $1 per contract only if every leg wins.
- Combos have no order book. kalshi_parlay_quote builds the combo from leg tickers and asks market makers for a price
  (an RFQ). The quote it returns is the price to buy YES on the combo, for exactly the contracts you asked for.
- To buy, propose_trade the combo ticker it returned: side buy, outcomeSide yes, limitPrice the quoted price,
  quantity the quoted contracts, no stop and no target. The quote is good for seconds to minutes; quote again if
  the proposal says it is gone.
- A combo cannot be sold before it settles (nothing to sell into). The most it loses is what it cost.
- Same-game limit: at most one line each of moneyline, spread and total from one game per combo (a spread and a total
  from the same game together are allowed, and are usually correlated).

## Work order
1. Shortlist legs with kalshi_markets (query KXNFLGAME, KXNFLSPREAD, KXNFLTOTAL, KXNFLPASSYDS, KXNFLRECYDS,
   KXNFLRSHYDS, KXNFLTEAMTOTAL). Read each leg's rules with kalshi_market.
2. Price every leg (below), then cut the legs with no edge or no evidence. Two to four strong legs beat six weak ones.
3. Join the legs (correlation, below) into one chance for the whole combo.
4. Quote it with kalshi_parlay_quote at the size the playbook allows. Buy only if the gate math clears.

## Price each leg, market first
- Start from the leg's own Kalshi price: the middle of its yes bid and ask. Cross-check against at least 2 sportsbooks
  (odds pages, odds articles) with the vig removed: p(A) = (1/decimal A) / (1/decimal A + 1/decimal B), averaged.
- Kalshi lists spreads, totals and prop ladders at many lines: use the exact line's market, not a shifted one.
- Adjust off the market only for a reason you can name: injury or QB news after the line was set, wind, a confirmed
  structural change. Cap the move at 4 points; when the market is 45 to 60%, cap it at 2 unless confirmed news
  arrived after the line moved (a wind forecast that rose to 15+ mph with no line move since counts). Name the
  exception when you use it. Your chance must stay within those caps of the market.
- A projection that disagrees with the market by X points of total or spread is worth about 3 probability points per
  point at most, and alone can never take a spread or total to 65% or higher.
- Any model or power rating is context only unless it has a published record against the closing line.
- Props: the same prop's line from 2+ books. If none, the leg stays within 45 to 55%. Check usage (snap share,
  targets or carries, last 4 games against season) and the last 5 games against the line, median as well as average.

## Must check for every leg (write each in the journal; a check you could not do lowers your chance or cuts the leg)
- Roster: both starting QBs and the key players active this week, from the latest injury report (practice reports
  Wed, Thu, Fri; final statuses Fri; inactives about 90 minutes before kickoff). Say which report and its date.
- Venue: stadium, roof, divisional game or not.
- Weather for open-air games: wind, rain chance, temperature, source and time.
- Team context from one recent beat-writer article per team: stakes, trades, benched players, coaching changes.
  Context is mostly priced in; it moves a leg only with a concrete fact, within the caps.
- Pace (seconds per play) and explosive play rate for both teams, with provider. UNVERIFIED if no page shows it.

## Weather (2002 to 2017 open-air evidence)
- Wind 15+ mph: lower overs and passing overs, raise unders, within the caps (unders hit 59% at 15 to 19 mph, 62% at
  20+). Wind 20+ mph or a thunderstorm in the game window: no overs or passing overs.
- Cold alone and light rain alone showed no effect. Domes showed none beyond the line.

## Brutality filter (every leg, before it goes in a combo)
- Attack each reason the leg wins: already in the price? small sample? due to regress? undercut by injury, weather
  or pace? a story rather than a number? Mark each SURVIVES, WEAKENED or DISMANTLED and take away the credit of any
  dismantled one. Add two new reasons it loses. Write the best short case for the other side.
- If no reason survives, drop the leg.
- Write what would kill the leg and the one piece of news before kickoff that would flip it.

## Join the legs (correlation)
- Never just multiply linked legs. Positive links: a favorite's spread with the game over, an underdog's spread with
  the under, a QB's passing yards with the over, a big favorite's spread with its RB's rushing over. Negative: a
  team's spread with the opponent's team total over, a game under with both QBs' passing overs.
- Without a backtest (say it is judgment): moderate positive, joint = product x 1.10 to 1.20; strong positive,
  x 1.20 to 1.40; negative, x 0.80 to 0.90. The joint can never exceed the least likely leg.
- Legs in different games are independent unless the same weather system hits both.
- Your fair for the combo is this joint chance. Show the leg chances, the product and the joint.

## The buy decision
- Edge = joint chance minus the quoted price minus the fee. Code needs at least 15% of the quoted price (a 0.10 quote
  needs 1.5 cents, a 0.40 quote 6 cents). Quotes usually sit near the product of the legs' prices, so most fail this:
  that is a pass, not a reason to raise a chance. The caps on each leg still apply; the gate never loosens them.
- Compare the quote with the product of the legs' Kalshi prices. A quote far below that product means the makers see
  something you do not: find it before buying.
- Size from the playbook (quarter Kelly on the joint chance). Quote at that size; quotes are for the full size.
- Keep Thursday legs out of Sunday combos: the whole combo is locked in before Friday's reports.
- At least 3 sources in the case (5 for full size): the combo rules, the legs' markets, books, injury report, weather.

## In the journal for every combo looked at, bought or not
Legs with their Kalshi price, book price, your chance and the one-line kill; the product, the joint and the
correlation reason; the quote, the edge and the decision. Code scores settled combos for calibration like any bet.
