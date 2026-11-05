# Richie's playbook

Version cash-satellite-1 (2026-11-02). Rewritten from the evidence below; core-satellite-1 with the SPY core removed
. What code enforces is not repeated here:
cash only (an order plus fees never above the cash the broker reports), the entry gates (a case written at the live
price, Kalshi edge of 5 cents after fees (15% of the price for a parlay), no chasing more than 2 cents), DeepSeek's PASS before every buy, no buys
while paused, exits never larger than the holding. There is no per-trade, position-count, daily or drawdown cap:
sizing below is strategy, and I follow it.

## Goal
The owner's aim is 5 to 10% a month. It is a target to measure against, not a promise and never a reason to force a
trade. The best version tested (with an SPY core) made about 27% over 13 months, about 2% a month, in a market that mostly rose. Beat
the S&P 500 after costs first; the monthly aim comes after that.

## Idle cash stays in cash
- The owner's choice: cash not in a satellite trade or a bet stays as cash. No SPY or other index core; code
  refuses a core buy.
- The cost, from the same test: the cash version made about 16% where the SPY core made about 27%, because cash sat
  idle 80 to 90% of the time. The weekly review keeps both side by side; a return to a core goes to the owner.

## Satellite: momentum with stops, up to 3 at a time
- Each satellite buy is about a third of the account (cash plus satellites). Three slots: two concentrated more
  but rested on 20 trades, which is luck until shown otherwise; five diluted the edge.
- Buy only confirmed momentum: close above a rising 20-day average, the 20-day above the 50-day, a new 20-day
  closing high, and volume at least 1.5x the 20-day average. Below either average, or the 20-day falling, is a
  bounce, not a setup: pass and note it.
- The sector must be in an uptrend too (its 20-day above its 50-day).
- An earnings or news gap counts only if price makes a new high after the gap.
- Liquid names only: large stocks and ETFs. Skip a spread wider than about 1% or thin volume.
- Stop 7% under entry; target 14% (2x the stop), on a real level when one exists. Exit at the stop, the target, a
  close under the 20-day average, a broken reason, or after 20 trading days, whichever comes first. Earnings or a
  high RSI alone are not exit reasons.
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

## Evidence (2026-11-02, 20 liquid names, 290 trading days of Robinhood daily bars, slippage and spread included)
- SPY held: +14.1%. Old strategy (3 swing slots, idle cash in cash): +15.9%, worst drop 7.0%.
- Core and satellite (this playbook): +27%, worst drop 6.9%, 29 trades, 48% won after costs.
- Split in two: first half +19.6% (SPY +8.0%, old +11.6%); second half -0.8% (SPY +0.7%, old -1.5%). It wins
  when the market rises and roughly matches it when flat. 29 trades is under the 30 the promotion check wants.
- Other entries tested lost to these: letting winners run until a 50-day break, buying pullbacks to the 20-day,
  50-day crossovers, and a market filter on SPY.

## Lessons kept from the old weekly reviews
- The 20/50 trend filter is the best loss-avoider. Six closed paper losses broke it or lacked a fresh high.
- Bounce-day gains below falling averages are traps (SMCI and MU stopped out).
- An earnings gap is not a fresh high (SPCX stopped out below its prior top).
- A target must sit on a real price level; an unsupported target is a pass.
- Full slots are not a reason to force a sell; winners need time while the structure holds.
- Volume and liquidity matter; thin names were passed for good reason.
