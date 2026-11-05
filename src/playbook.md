# Richie's playbook

Version core-trail-1, chosen after the long-history test (docs/history-backtest.md). It replaces cash-satellite-1,
whose rules now run on paper only. What code enforces is not repeated here:
cash only (an order plus fees never above the cash the broker reports), the entry gates (a case written at the live
price, Kalshi edge of 5 cents after fees (15% of the price for a parlay), no chasing more than 2 cents), DeepSeek's PASS before every buy, no buys
while paused, exits never larger than the holding, the SPY core, and the trailing stops. There is no per-trade,
position-count, daily or drawdown cap: sizing below is strategy, and I follow it.

## Goal
The owner's aim is 5 to 10% a month. It is a target to measure against, not a promise and never a reason to force a
trade. Over 22 years no tested rule beat SPY held (about 10% a year); the realistic first goal is to match SPY after
costs, and every month the account is scored against the same money in SPY.

## The SPY core (code, not me)
- The owner sets my share of the Robinhood account (RICHIE_TRADING_PERCENT, 20% unless they change it); the session
  prompt states the split. The rest is SPY. Code buys it from cash in market hours, at least $1 at a time, and holds
  it with no stop. I never buy it, never use it as a satellite, and never sell it: only the owner does.
- Code never sells SPY to fund a satellite. Cash from a satellite's exit refills my share first; only what is over it
  goes to SPY.

## Satellite: momentum, up to 2 at a time, my share
- My money is the Robinhood cash code leaves beside the core. Up to 2 satellites at once, each about half of my share
  and never under $1 (Robinhood's smallest fractional order). With only enough for one, one.
- Buy only confirmed momentum: close above a rising 20-day average, the 20-day above the 50-day, a new 20-day
  closing high, and volume at least 1.5x the 20-day average. Below either average, or the 20-day falling, is a
  bounce, not a setup: pass and note it.
- The sector must be in an uptrend too (its 20-day above its 50-day).
- An earnings or news gap counts only if price makes a new high after the gap.
- Liquid names only: large stocks and ETFs. Skip a spread wider than about 1% or thin volume.
- The exit is code's: a stock or ETF exits only on a 20% trailing stop under its highest close since entry, which
  starts 20% under the entry and only rises. No target, no time limit, no average exit: the test showed cutting
  winners early is what lost to SPY. I do not write a stop or target for a stock or ETF case.
- I sell a satellite early only when the invalidation written in its case has actually happened (a deal broke, a
  fraud, guidance withdrawn), never on a dip, a high RSI or earnings alone.
- Positions bought under earlier rules keep the stop and target they were bought with.
- A blank or failed research check is a pass, never a buy. Missing data is not a signal.

## Crypto
- Only liquid majors Robinhood lists, only on a fresh breakout above a clear range with price above the 20-day and
  50-day averages, and only with a recent catalyst, the 30-day trend and at least 3 sources.
- Crypto moves harder and around the clock: use a smaller size than a stock satellite, with the same 7% stop.

## Kalshi
- Bet only where my own chance, argued from evidence (data, forecasts, base rates), beats the price by at least 5
  cents after the fee, the rules are quoted, the market settles within 14 days, and I cite at least 3 sources.
- Prefer prices between 5 and 95 cents: long shots and near-certainties lose most to the fee.
- Size: a quarter of the Kelly fraction of the Kalshi account, where
  Kelly for a contract costing c (fee included) that pays $1 with my chance p is (p - c) / (1 - c). Under 5 cited
  sources it is halved. Code refuses a larger bet and says how many contracts fit. The chance must come from the
  evidence: a bet refused in a session cannot come back with a higher chance unless it cites a source not cited before.
- At 90 cents or more, a small error in my chance erases the edge: bet only when published data already settles most
  of the outcome, not on a strong lean. Sources that contradict each other are a pass.
- Settled bets are scored for calibration (Brier score of my stated chance against the result; 0.25 is a coin flip).
  From 5 settled bets, code scales the size: 0.10 or better keeps it, up to 0.20 halves it, worse quarters it.

## Kalshi parlays (NFL)
- Parlays are traded in Kalshi sessions. Before building, quoting or buying one, read the kalshi-parlays skill
  (src/skills/kalshi-parlays) with skill_read and follow it.
- A parlay is priced leg by leg from each leg's own market, joined for correlation, then bought only when that joint
  chance beats the quote by at least 15% of the quote after the fee (relative, since a flat 5 cents
  on a cheap parlay asks for more than the per-leg caps allow). The Kalshi sizing above applies to the joint chance.
- Two to four legs with a real reason each. Most quotes carry the makers' margin on every leg: passing is normal.
- A parlay is held to settlement: no stop, no target, nothing to sell into. Code refuses one with either.

## Evidence (docs/history-backtest.md, daily bars back to 1999, costs included)
- The old rules (3 satellites, 7% stop, 14% target, 20-day limit, idle cash in cash) trailed SPY by 7 to 10 points a
  year on every universe picked without hindsight, and ranked 82nd to 94th of 96 variants.
- 80% SPY with a 20% momentum satellite on a 20% trailing stop, 2004 to 2026: about 10.2 to 10.4% a year against
  SPY's 10.7%, with a slightly smaller worst drop (49 to 51% against 55%).
- A bigger share costs more: 35% SPY and 65% satellite was 0.2 to 0.7 points a year under SPY over the full periods,
  but 0.7 to 4.7 points under it since 2015. What my share buys is a live record of my judgment, which no backtest
  can give.
- The share grows only after 100 or more live trades show it beats the same money in SPY, and only on the owner's
  yes. 30 trades cannot tell an edge from luck.

## Lessons kept from the old weekly reviews
- The 20/50 trend filter is the best loss-avoider. Six closed paper losses broke it or lacked a fresh high.
- Bounce-day gains below falling averages are traps (SMCI and MU stopped out).
- An earnings gap is not a fresh high (SPCX stopped out below its prior top).
- A target must sit on a real price level; an unsupported target is a pass.
- Full slots are not a reason to force a sell; winners need time while the structure holds.
- Volume and liquidity matter; thin names were passed for good reason.
