# Richie stock rules on long history (2026-11-05)

Engine: strategy.mjs evaluatePortfolio, slippage 0.05% and spread 0.1% per side. Data: Yahoo daily bars, dividend adjusted, to 2026-11-05.
Every variant: 4 entries x 6 exits x 3 or 5 slots x idle cash in cash or in SPY = 96 per universe.

## SECTORS: 9 names, 1999 to 2026

SPY held: 8.5% a year, Sharpe 0.52, worst drop 55.2%. First half to 2013: 2.4%; second half: 14.7%.

| Entry | Exit | Slots | Idle cash | Trades/yr | Yearly | vs SPY | Sharpe | Worst drop | Won | Avg trade (t) | 1st half | 2nd half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| momentum | 20% trailing stop | 5 | SPY | 2 | 9.6% | 1.1% | 0.60 | 55.5% | 48.1% | 22.4% (3.0) | 3.5% | -1.1% |
| momentum | 20% trailing stop | 3 | SPY | 1 | 9.3% | 0.8% | 0.57 | 55.4% | 48.4% | 25.6% (2.5) | 3.9% | -2.2% |
| 50-day high, above 200-day | 20% trailing stop | 5 | SPY | 2 | 8.5% | 0.0% | 0.55 | 53.6% | 48.9% | 23.8% (2.6) | 2.5% | -3.4% |
| momentum, no volume | 20% trailing stop | 5 | SPY | 2 | 8.4% | -0.0% | 0.54 | 55.0% | 37.7% | 18.4% (2.6) | 2.4% | -3.8% |
| 50-day high, above 200-day | 20% trailing stop | 3 | SPY | 1 | 8.3% | -0.2% | 0.53 | 56.4% | 51.6% | 18.4% (1.9) | 2.2% | -2.3% |
| 52-week high | 20% trailing stop | 5 | SPY | 2 | 7.8% | -0.6% | 0.51 | 56.6% | 44.4% | 14.7% (2.1) | 0.2% | -2.0% |
| 52-week high | 20% trailing stop | 3 | SPY | 1 | 7.6% | -0.9% | 0.50 | 54.2% | 44.4% | 14.4% (1.5) | 0.2% | -2.6% |
| momentum | 10% trailing stop | 5 | SPY | 6 | 7.4% | -1.1% | 0.48 | 54.6% | 47.5% | 3.9% (2.9) | 0.2% | -2.5% |
| 52-week high | 10% trailing stop | 5 | SPY | 5 | 7.4% | -1.1% | 0.48 | 54.2% | 48.5% | 3.8% (2.7) | 0.0% | -2.5% |
| momentum | 20% trailing stop | 3 | cash | 1 | 7.4% | -1.1% | 0.56 | 47.1% | 48.4% | 25.6% (2.5) | 3.1% | -5.6% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 15 | 7.3% | -1.2% | 0.47 | 55.7% | 38.2% | 0.3% (0.9) | -0.0% | -2.4% |
| momentum, no volume | 20% trailing stop | 3 | SPY | 1 | 7.3% | -1.2% | 0.49 | 52.5% | 34.3% | 16.9% (1.7) | 1.3% | -4.7% |
| 52-week high | 10% trailing stop | 3 | SPY | 4 | 7.3% | -1.2% | 0.47 | 53.5% | 46.0% | 3.2% (1.9) | -0.7% | -2.7% |
| 50-day high, above 200-day | 10% trailing stop | 5 | SPY | 5 | 7.3% | -1.2% | 0.47 | 51.9% | 52.0% | 4.7% (3.4) | 0.0% | -3.2% |
| momentum | 20% trailing stop | 5 | cash | 2 | 7.2% | -1.2% | 0.58 | 43.3% | 48.1% | 22.4% (3.0) | 2.4% | -4.9% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 18 | 7.2% | -1.3% | 0.46 | 53.2% | 35.8% | 0.2% (0.9) | 0.1% | -2.8% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 20 | 7.2% | -1.3% | 0.46 | 51.9% | 37.5% | 0.5% (2.0) | -0.2% | -2.6% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | SPY | 16 | 7.1% | -1.4% | 0.46 | 53.2% | 37.1% | 0.1% (0.4) | -0.0% | -3.0% |
| momentum | 10% trailing stop | 3 | SPY | 4 | 7.1% | -1.4% | 0.46 | 51.7% | 46.4% | 3.1% (2.0) | -0.2% | -3.1% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | SPY | 31 | 7.0% | -1.5% | 0.45 | 55.2% | 39.4% | 0.2% (1.6) | -1.4% | -1.7% |
| momentum | 7% stop, ride above 50-day avg | 5 | SPY | 14 | 6.9% | -1.6% | 0.45 | 56.0% | 39.3% | 0.1% (0.4) | -0.3% | -3.0% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | SPY | 18 | 6.9% | -1.6% | 0.45 | 51.9% | 38.8% | 0.5% (2.0) | -0.1% | -3.3% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 13 | 6.9% | -1.6% | 0.44 | 52.2% | 37.4% | 0.3% (1.2) | 0.1% | -3.9% |
| 50-day high, above 200-day | 10% trailing stop | 3 | SPY | 4 | 6.8% | -1.6% | 0.45 | 51.9% | 47.2% | 4.0% (2.3) | -0.1% | -4.2% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 21 | 6.8% | -1.7% | 0.44 | 55.6% | 35.1% | -0.2% (-1.2) | -1.3% | -2.1% |
| momentum, no volume | 10% trailing stop | 5 | SPY | 7 | 6.8% | -1.7% | 0.45 | 51.6% | 45.6% | 3.2% (3.1) | -0.1% | -4.0% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 11 | 6.7% | -1.8% | 0.43 | 56.5% | 39.4% | 0.2% (0.6) | -0.1% | -3.3% |
| momentum | 7% stop, ride above 50-day avg | 3 | SPY | 10 | 6.7% | -1.8% | 0.43 | 56.7% | 41.5% | 0.3% (0.8) | 0.2% | -3.9% |
| momentum | 7% stop, ride above 20-day avg | 5 | SPY | 20 | 6.7% | -1.8% | 0.43 | 55.4% | 33.9% | -0.2% (-1.5) | -1.2% | -2.5% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | SPY | 23 | 6.6% | -1.8% | 0.43 | 57.1% | 40.2% | 0.2% (1.6) | -1.6% | -2.1% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | SPY | 27 | 6.6% | -1.8% | 0.43 | 55.5% | 36.7% | -0.0% (-0.3) | -1.4% | -2.4% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 25 | 6.6% | -1.8% | 0.44 | 50.3% | 37.8% | 0.4% (1.8) | 0.3% | -4.4% |
| momentum, no volume | 10% trailing stop | 3 | SPY | 5 | 6.6% | -1.9% | 0.44 | 49.9% | 45.5% | 2.7% (2.2) | -1.6% | -3.4% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | SPY | 21 | 6.5% | -2.0% | 0.43 | 56.9% | 38.3% | 0.1% (0.5) | -1.7% | -2.3% |
| momentum, no volume | 20% trailing stop | 5 | cash | 2 | 6.4% | -2.1% | 0.50 | 46.4% | 37.7% | 18.4% (2.6) | 0.7% | -6.2% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 17 | 6.3% | -2.1% | 0.42 | 49.3% | 38.3% | 0.3% (1.3) | 0.0% | -4.9% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | SPY | 12 | 6.3% | -2.2% | 0.41 | 52.1% | 37.3% | 0.1% (0.2) | -0.2% | -4.6% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 38 | 6.3% | -2.2% | 0.41 | 56.2% | 38.7% | 0.1% (0.9) | -2.0% | -2.4% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 15 | 6.2% | -2.2% | 0.41 | 53.6% | 36.5% | 0.4% (1.4) | -1.0% | -3.8% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 18 | 6.2% | -2.2% | 0.41 | 55.8% | 37.8% | -0.1% (-0.6) | -1.0% | -3.6% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | SPY | 22 | 6.2% | -2.3% | 0.41 | 50.5% | 38.1% | 0.3% (1.3) | 0.0% | -4.9% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | SPY | 40 | 6.2% | -2.3% | 0.41 | 55.5% | 37.1% | 0.1% (0.6) | -1.1% | -3.7% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 33 | 6.1% | -2.4% | 0.40 | 55.5% | 36.1% | -0.1% (-0.9) | -1.7% | -3.1% |
| 50-day high, above 200-day | 20% trailing stop | 5 | cash | 2 | 6.0% | -2.5% | 0.54 | 38.2% | 48.9% | 23.8% (2.6) | 1.0% | -7.0% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 26 | 5.9% | -2.6% | 0.39 | 56.5% | 36.9% | 0.0% (0.0) | -2.2% | -3.0% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | SPY | 14 | 5.8% | -2.6% | 0.39 | 50.9% | 36.9% | 0.3% (1.2) | -0.7% | -5.1% |
| momentum | 7% stop, ride above 20-day avg | 3 | SPY | 16 | 5.8% | -2.7% | 0.39 | 56.5% | 35.4% | -0.2% (-1.1) | -1.5% | -4.1% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 29 | 5.6% | -2.9% | 0.38 | 58.5% | 38.8% | 0.1% (1.0) | -2.4% | -3.4% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 48 | 5.6% | -2.9% | 0.38 | 55.7% | 36.8% | 0.0% (0.2) | -1.2% | -4.7% |
| momentum, no volume | 20% trailing stop | 3 | cash | 1 | 5.6% | -2.9% | 0.45 | 50.1% | 34.3% | 16.9% (1.7) | -0.1% | -6.8% |
| 50-day high, above 200-day | 20% trailing stop | 3 | cash | 1 | 5.5% | -3.0% | 0.46 | 43.7% | 51.6% | 18.4% (1.9) | 0.2% | -6.9% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | SPY | 16 | 4.9% | -3.6% | 0.35 | 49.6% | 37.3% | 0.1% (0.3) | -0.5% | -7.0% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | SPY | 29 | 4.6% | -3.8% | 0.33 | 57.2% | 36.4% | 0.0% (0.0) | -2.6% | -5.3% |
| 50-day high, above 200-day | 10% trailing stop | 5 | cash | 5 | 4.3% | -4.2% | 0.48 | 27.8% | 52.0% | 4.7% (3.4) | -0.4% | -9.0% |
| 52-week high | 20% trailing stop | 5 | cash | 2 | 4.2% | -4.3% | 0.41 | 39.3% | 44.4% | 14.7% (2.1) | -2.9% | -6.1% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 35 | 4.1% | -4.4% | 0.31 | 56.9% | 35.7% | -0.0% (-0.2) | -2.9% | -6.0% |
| momentum | 10% trailing stop | 5 | cash | 6 | 4.1% | -4.4% | 0.44 | 39.8% | 47.5% | 3.9% (2.9) | -0.7% | -8.7% |
| 50-day high, above 200-day | 10% trailing stop | 3 | cash | 4 | 4.0% | -4.4% | 0.42 | 38.2% | 47.2% | 4.0% (2.3) | -0.9% | -9.2% |
| momentum, no volume | 10% trailing stop | 5 | cash | 7 | 4.0% | -4.5% | 0.40 | 41.3% | 45.6% | 3.2% (3.1) | -1.7% | -7.9% |
| 52-week high | 20% trailing stop | 3 | cash | 1 | 3.7% | -4.7% | 0.35 | 45.2% | 44.4% | 14.4% (1.5) | -3.7% | -6.8% |
| momentum, no volume | 10% trailing stop | 3 | cash | 5 | 3.6% | -4.9% | 0.34 | 49.5% | 45.5% | 2.7% (2.2) | -3.7% | -7.4% |
| momentum | 10% trailing stop | 3 | cash | 4 | 3.5% | -5.0% | 0.35 | 41.1% | 46.4% | 3.1% (2.0) | -1.4% | -9.5% |
| 52-week high | 10% trailing stop | 5 | cash | 5 | 3.1% | -5.4% | 0.38 | 27.6% | 48.5% | 3.8% (2.7) | -2.4% | -8.8% |
| 52-week high | 10% trailing stop | 3 | cash | 4 | 3.0% | -5.4% | 0.34 | 42.3% | 46.0% | 3.2% (1.9) | -3.7% | -8.2% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 20 | 1.8% | -6.7% | 0.28 | 18.0% | 37.5% | 0.5% (2.0) | -1.2% | -12.5% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | cash | 23 | 1.8% | -6.7% | 0.27 | 29.1% | 40.2% | 0.2% (1.6) | -2.8% | -10.7% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 15 | 1.7% | -6.8% | 0.23 | 29.6% | 36.5% | 0.4% (1.4) | -2.1% | -12.0% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 25 | 1.7% | -6.8% | 0.22 | 28.0% | 37.8% | 0.4% (1.8) | -1.8% | -12.4% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | cash | 18 | 1.6% | -6.9% | 0.24 | 18.4% | 38.8% | 0.5% (2.0) | -1.2% | -13.0% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 17 | 1.5% | -7.0% | 0.19 | 35.7% | 38.3% | 0.3% (1.3) | -3.0% | -11.6% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | cash | 14 | 1.3% | -7.2% | 0.18 | 30.2% | 36.9% | 0.3% (1.2) | -1.7% | -13.3% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | cash | 31 | 1.2% | -7.3% | 0.23 | 22.1% | 39.4% | 0.2% (1.6) | -2.7% | -12.0% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 13 | 1.2% | -7.3% | 0.18 | 24.6% | 37.4% | 0.3% (1.2) | -2.8% | -12.5% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | cash | 22 | 1.1% | -7.4% | 0.17 | 33.3% | 38.1% | 0.3% (1.3) | -2.5% | -12.7% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 29 | 1.1% | -7.4% | 0.17 | 29.1% | 38.8% | 0.1% (1.0) | -3.5% | -11.6% |
| momentum | 7% stop, ride above 50-day avg | 3 | cash | 10 | 0.7% | -7.7% | 0.13 | 28.4% | 41.5% | 0.3% (0.8) | -2.6% | -13.1% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 15 | 0.7% | -7.8% | 0.13 | 23.1% | 38.2% | 0.3% (0.9) | -2.3% | -13.5% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 38 | 0.7% | -7.8% | 0.15 | 22.5% | 38.7% | 0.1% (0.9) | -3.3% | -12.4% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 18 | 0.6% | -7.9% | 0.12 | 16.9% | 35.8% | 0.2% (0.9) | -2.9% | -13.2% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 11 | 0.5% | -8.0% | 0.10 | 30.2% | 39.4% | 0.2% (0.6) | -3.0% | -13.1% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | cash | 40 | 0.5% | -8.0% | 0.10 | 37.9% | 37.1% | 0.1% (0.6) | -4.0% | -12.2% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | cash | 21 | 0.4% | -8.1% | 0.09 | 35.5% | 38.3% | 0.1% (0.5) | -4.5% | -11.8% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | cash | 16 | 0.2% | -8.2% | 0.07 | 20.9% | 37.1% | 0.1% (0.4) | -3.2% | -13.6% |
| momentum | 7% stop, ride above 50-day avg | 5 | cash | 14 | 0.2% | -8.3% | 0.07 | 24.4% | 39.3% | 0.1% (0.4) | -3.0% | -13.9% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 48 | 0.1% | -8.4% | 0.05 | 35.2% | 36.8% | 0.0% (0.2) | -4.0% | -13.0% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | cash | 16 | 0.1% | -8.4% | 0.06 | 42.5% | 37.3% | 0.1% (0.3) | -4.0% | -13.3% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | cash | 12 | 0.1% | -8.4% | 0.05 | 30.7% | 37.3% | 0.1% (0.2) | -3.5% | -14.0% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 26 | -0.1% | -8.6% | 0.02 | 34.3% | 36.9% | 0.0% (0.0) | -4.9% | -12.4% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | cash | 29 | -0.2% | -8.7% | 0.02 | 52.4% | 36.4% | 0.0% (0.0) | -5.7% | -12.0% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | cash | 27 | -0.3% | -8.7% | -0.02 | 28.4% | 36.7% | -0.0% (-0.3) | -4.3% | -13.3% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 35 | -0.5% | -9.0% | -0.01 | 50.5% | 35.7% | -0.0% (-0.2) | -5.8% | -12.3% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 18 | -0.6% | -9.1% | -0.06 | 31.3% | 37.8% | -0.1% (-0.6) | -3.9% | -14.7% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 33 | -0.7% | -9.1% | -0.10 | 29.5% | 36.1% | -0.1% (-0.9) | -4.5% | -14.0% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 21 | -0.7% | -9.2% | -0.13 | 31.5% | 35.1% | -0.2% (-1.2) | -4.2% | -14.5% |
| momentum | 7% stop, ride above 20-day avg | 5 | cash | 20 | -1.0% | -9.4% | -0.16 | 34.3% | 33.9% | -0.2% (-1.5) | -4.5% | -14.7% |
| momentum | 7% stop, ride above 20-day avg | 3 | cash | 16 | -1.3% | -9.7% | -0.14 | 40.5% | 35.4% | -0.2% (-1.1) | -5.1% | -14.8% |

Walk forward (idle cash in cash): best on the first half was "momentum / 20% trailing stop / 3 slots" at 3.1% a year vs SPY; on the second half it did -5.6%, rank 2 of 48. 0 of 48 variants beat SPY in the second half.

Walk forward (idle cash in SPY): best on the first half was "momentum / 20% trailing stop / 3 slots" at 3.9% a year vs SPY; on the second half it did -2.2%, rank 6 of 48. 0 of 48 variants beat SPY in the second half.

## BIG2004: 20 names, 2005 to 2026

SPY held: 10.8% a year, Sharpe 0.64, worst drop 55.2%. First half to 2016: 7.0%; second half: 15.0%.

| Entry | Exit | Slots | Idle cash | Trades/yr | Yearly | vs SPY | Sharpe | Worst drop | Won | Avg trade (t) | 1st half | 2nd half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| momentum | 20% trailing stop | 3 | SPY | 2 | 11.5% | 0.7% | 0.69 | 36.4% | 44.7% | 25.7% (2.0) | 3.7% | 1.3% |
| momentum | 20% trailing stop | 5 | SPY | 3 | 11.0% | 0.3% | 0.69 | 39.9% | 48.3% | 23.0% (2.4) | 1.5% | -2.5% |
| 50-day high, above 200-day | 20% trailing stop | 3 | SPY | 1 | 10.8% | -0.0% | 0.67 | 45.5% | 66.7% | 37.9% (2.0) | 2.9% | -5.9% |
| momentum | 10% trailing stop | 3 | SPY | 7 | 10.7% | -0.1% | 0.62 | 46.5% | 49.3% | 3.4% (2.5) | 0.0% | 0.1% |
| 52-week high | 20% trailing stop | 5 | SPY | 2 | 10.4% | -0.4% | 0.67 | 46.6% | 56.1% | 29.5% (2.8) | 2.9% | -3.9% |
| 52-week high | 10% trailing stop | 5 | SPY | 10 | 10.4% | -0.4% | 0.64 | 49.1% | 43.8% | 3.5% (2.8) | 0.1% | -1.1% |
| momentum, no volume | 10% trailing stop | 3 | SPY | 7 | 10.4% | -0.4% | 0.62 | 47.8% | 45.5% | 4.0% (2.9) | -0.6% | -0.1% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | SPY | 42 | 10.3% | -0.5% | 0.62 | 56.4% | 40.0% | 0.5% (2.6) | -2.0% | 1.0% |
| 50-day high, above 200-day | 20% trailing stop | 3 | cash | 1 | 10.2% | -0.6% | 0.75 | 27.3% | 66.7% | 37.9% (2.0) | 2.9% | -6.6% |
| momentum | 10% trailing stop | 5 | SPY | 11 | 10.2% | -0.6% | 0.62 | 50.1% | 43.6% | 2.8% (2.6) | -1.5% | 0.2% |
| 50-day high, above 200-day | 20% trailing stop | 5 | SPY | 2 | 10.1% | -0.7% | 0.65 | 46.0% | 58.5% | 28.2% (2.7) | 2.1% | -5.8% |
| 50-day high, above 200-day | 10% trailing stop | 3 | SPY | 6 | 10.1% | -0.7% | 0.61 | 42.5% | 45.9% | 3.5% (2.2) | -0.3% | -1.5% |
| 50-day high, above 200-day | 10% trailing stop | 5 | SPY | 10 | 9.9% | -0.9% | 0.62 | 44.7% | 46.8% | 3.7% (3.1) | -0.2% | -1.8% |
| momentum | 20% trailing stop | 3 | cash | 2 | 9.8% | -1.0% | 0.69 | 39.6% | 44.7% | 25.7% (2.0) | 5.1% | -2.3% |
| 52-week high | 10% trailing stop | 3 | SPY | 6 | 9.8% | -1.0% | 0.59 | 47.2% | 42.2% | 3.4% (2.1) | -0.6% | -1.8% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 17 | 9.7% | -1.1% | 0.56 | 53.8% | 39.6% | 0.8% (1.8) | -0.1% | -2.3% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 53 | 9.6% | -1.2% | 0.59 | 57.2% | 39.4% | 0.3% (2.5) | -2.7% | 0.4% |
| momentum | 20% trailing stop | 5 | cash | 3 | 9.3% | -1.5% | 0.71 | 36.8% | 46.6% | 22.6% (2.4) | 2.5% | -5.9% |
| 50-day high, above 200-day | 20% trailing stop | 5 | cash | 2 | 9.3% | -1.5% | 0.74 | 27.4% | 58.5% | 28.2% (2.7) | 1.9% | -7.4% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | SPY | 26 | 9.2% | -1.6% | 0.57 | 52.1% | 39.3% | 1.0% (2.5) | -2.0% | -1.1% |
| 52-week high | 20% trailing stop | 3 | SPY | 1 | 9.2% | -1.6% | 0.60 | 41.6% | 56.5% | 27.5% (1.8) | 5.0% | -5.9% |
| momentum | 7% stop, ride above 50-day avg | 5 | SPY | 23 | 9.2% | -1.6% | 0.55 | 52.7% | 37.2% | 0.5% (1.2) | -2.8% | -0.4% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 26 | 9.2% | -1.6% | 0.57 | 55.5% | 38.8% | 0.8% (2.5) | -2.4% | -0.9% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | SPY | 23 | 9.1% | -1.7% | 0.56 | 54.0% | 39.3% | 0.8% (2.1) | -2.9% | -0.5% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 39 | 9.0% | -1.8% | 0.55 | 58.0% | 40.5% | 0.3% (2.0) | -2.2% | -1.4% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 25 | 8.9% | -1.9% | 0.54 | 57.2% | 38.0% | 0.5% (1.4) | -2.9% | -0.9% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | SPY | 31 | 8.9% | -1.9% | 0.54 | 57.7% | 38.8% | 0.4% (1.7) | -2.7% | -1.2% |
| momentum | 7% stop, ride above 50-day avg | 3 | SPY | 15 | 8.8% | -2.0% | 0.52 | 57.1% | 37.5% | 0.7% (1.4) | -4.2% | 0.5% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | SPY | 17 | 8.8% | -2.0% | 0.53 | 54.7% | 39.4% | 1.0% (1.9) | -2.0% | -2.2% |
| momentum, no volume | 10% trailing stop | 3 | cash | 7 | 8.7% | -2.0% | 0.65 | 31.2% | 45.5% | 4.0% (2.9) | -0.9% | -2.7% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 19 | 8.7% | -2.1% | 0.53 | 53.5% | 39.6% | 1.0% (2.4) | -1.8% | -2.6% |
| momentum, no volume | 10% trailing stop | 5 | SPY | 12 | 8.5% | -2.3% | 0.55 | 50.1% | 42.5% | 3.1% (3.1) | -1.8% | -2.9% |
| momentum | 7% stop, ride above 20-day avg | 3 | SPY | 26 | 8.3% | -2.5% | 0.49 | 54.8% | 39.9% | 0.2% (0.7) | -2.7% | -2.3% |
| 52-week high | 20% trailing stop | 5 | cash | 2 | 8.2% | -2.6% | 0.68 | 28.8% | 56.1% | 29.5% (2.8) | 1.3% | -6.1% |
| 52-week high | 20% trailing stop | 3 | cash | 1 | 8.1% | -2.7% | 0.63 | 24.8% | 56.5% | 27.5% (1.8) | 3.7% | -6.2% |
| momentum | 7% stop, ride above 20-day avg | 5 | SPY | 35 | 7.9% | -2.9% | 0.49 | 55.9% | 39.5% | 0.1% (0.4) | -2.5% | -3.3% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 29 | 7.8% | -3.0% | 0.50 | 52.0% | 38.1% | 0.7% (2.3) | -3.1% | -2.9% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 18 | 7.7% | -3.0% | 0.49 | 54.2% | 38.7% | 0.7% (1.8) | -1.1% | -5.4% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | SPY | 50 | 7.6% | -3.2% | 0.49 | 53.8% | 38.4% | 0.3% (1.6) | -4.2% | -2.2% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | SPY | 16 | 7.5% | -3.3% | 0.47 | 55.6% | 38.2% | 0.7% (1.3) | -3.9% | -2.7% |
| momentum | 10% trailing stop | 3 | cash | 7 | 7.3% | -3.4% | 0.56 | 28.4% | 49.3% | 3.4% (2.5) | -2.3% | -3.9% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 63 | 7.1% | -3.7% | 0.47 | 55.0% | 38.0% | 0.2% (1.5) | -4.5% | -2.8% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 41 | 7.1% | -3.7% | 0.46 | 55.9% | 39.8% | -0.0% (-0.1) | -1.7% | -5.9% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 31 | 7.0% | -3.8% | 0.44 | 54.8% | 41.2% | 0.1% (0.5) | -1.8% | -5.9% |
| 50-day high, above 200-day | 10% trailing stop | 5 | cash | 10 | 7.0% | -3.8% | 0.63 | 26.2% | 46.8% | 3.7% (3.1) | -1.4% | -5.8% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | SPY | 35 | 7.0% | -3.8% | 0.45 | 55.5% | 36.7% | 0.3% (1.3) | -5.1% | -2.5% |
| momentum, no volume | 20% trailing stop | 5 | SPY | 2 | 6.9% | -3.9% | 0.49 | 40.5% | 41.7% | 15.3% (1.5) | 1.9% | -7.9% |
| 50-day high, above 200-day | 10% trailing stop | 3 | cash | 6 | 6.8% | -4.0% | 0.55 | 25.0% | 45.9% | 3.5% (2.2) | -2.4% | -5.5% |
| momentum, no volume | 10% trailing stop | 5 | cash | 12 | 6.8% | -4.0% | 0.58 | 33.4% | 42.5% | 3.1% (3.1) | -2.1% | -5.6% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 34 | 6.7% | -4.1% | 0.45 | 62.2% | 38.2% | 0.6% (1.9) | -4.3% | -3.9% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | SPY | 59 | 6.6% | -4.2% | 0.44 | 58.5% | 37.5% | 0.2% (1.4) | -4.8% | -3.7% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 43 | 6.6% | -4.2% | 0.43 | 56.1% | 37.9% | 0.2% (1.1) | -3.5% | -5.0% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 49 | 6.5% | -4.3% | 0.42 | 57.4% | 37.7% | 0.2% (1.2) | -4.6% | -4.2% |
| 52-week high | 10% trailing stop | 3 | cash | 6 | 6.5% | -4.3% | 0.53 | 24.3% | 42.2% | 3.4% (2.1) | -2.9% | -5.6% |
| momentum, no volume | 20% trailing stop | 3 | SPY | 1 | 6.4% | -4.4% | 0.45 | 45.3% | 35.7% | 18.9% (1.1) | 1.5% | -7.9% |
| 52-week high | 10% trailing stop | 5 | cash | 10 | 6.4% | -4.4% | 0.60 | 21.5% | 43.8% | 3.5% (2.8) | -2.1% | -6.5% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | SPY | 30 | 6.1% | -4.7% | 0.41 | 60.3% | 37.8% | 0.5% (1.6) | -4.9% | -4.4% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 22 | 6.1% | -4.7% | 0.40 | 64.4% | 38.3% | 0.6% (1.6) | -5.1% | -4.4% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | SPY | 19 | 6.0% | -4.8% | 0.40 | 61.8% | 39.6% | 0.6% (1.5) | -3.9% | -5.7% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | SPY | 39 | 6.0% | -4.8% | 0.40 | 54.8% | 36.1% | 0.2% (1.1) | -5.2% | -4.6% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 74 | 6.0% | -4.8% | 0.41 | 58.5% | 37.4% | 0.1% (1.0) | -6.0% | -3.6% |
| momentum, no volume | 20% trailing stop | 5 | cash | 2 | 5.8% | -5.0% | 0.49 | 33.3% | 41.7% | 15.3% (1.5) | 1.8% | -9.3% |
| momentum, no volume | 20% trailing stop | 3 | cash | 1 | 5.7% | -5.1% | 0.46 | 37.0% | 35.7% | 18.9% (1.1) | 1.2% | -8.4% |
| momentum | 10% trailing stop | 5 | cash | 11 | 5.7% | -5.1% | 0.51 | 35.1% | 43.6% | 2.8% (2.6) | -4.9% | -5.1% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 19 | 5.5% | -5.3% | 0.48 | 34.4% | 39.6% | 1.0% (2.4) | -3.9% | -6.7% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | cash | 17 | 4.7% | -6.1% | 0.40 | 39.6% | 39.4% | 1.0% (1.9) | -4.8% | -7.5% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | cash | 26 | 4.6% | -6.2% | 0.45 | 22.7% | 39.3% | 1.0% (2.5) | -5.3% | -7.1% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | cash | 42 | 4.1% | -6.7% | 0.50 | 20.4% | 40.0% | 0.5% (2.6) | -6.1% | -7.5% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 17 | 4.0% | -6.8% | 0.35 | 34.6% | 39.6% | 0.8% (1.8) | -5.3% | -8.4% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 26 | 4.0% | -6.8% | 0.43 | 25.8% | 38.8% | 0.8% (2.5) | -6.0% | -7.7% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 29 | 3.8% | -7.0% | 0.40 | 20.8% | 38.1% | 0.7% (2.3) | -5.4% | -8.6% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 22 | 3.7% | -7.1% | 0.32 | 49.7% | 38.3% | 0.6% (1.6) | -6.9% | -7.3% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 18 | 3.6% | -7.2% | 0.35 | 30.5% | 38.7% | 0.7% (1.8) | -4.7% | -9.7% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 34 | 3.6% | -7.2% | 0.35 | 47.5% | 38.2% | 0.6% (1.9) | -6.8% | -7.6% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 39 | 3.6% | -7.2% | 0.38 | 28.6% | 40.5% | 0.3% (2.0) | -6.7% | -7.7% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | cash | 23 | 3.5% | -7.3% | 0.37 | 23.8% | 39.3% | 0.8% (2.1) | -6.9% | -7.6% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | cash | 31 | 3.4% | -7.4% | 0.35 | 31.4% | 38.8% | 0.4% (1.7) | -7.2% | -7.6% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 53 | 3.2% | -7.6% | 0.42 | 22.6% | 39.4% | 0.3% (2.5) | -7.1% | -8.2% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | cash | 19 | 3.2% | -7.6% | 0.29 | 49.8% | 39.6% | 0.6% (1.5) | -6.0% | -9.1% |
| momentum | 7% stop, ride above 50-day avg | 3 | cash | 15 | 3.0% | -7.8% | 0.28 | 47.8% | 37.5% | 0.7% (1.4) | -9.2% | -6.0% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | cash | 30 | 2.7% | -8.1% | 0.27 | 47.7% | 37.8% | 0.5% (1.6) | -7.6% | -8.5% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | cash | 16 | 2.7% | -8.1% | 0.27 | 35.0% | 38.2% | 0.7% (1.3) | -8.0% | -8.1% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | cash | 35 | 2.5% | -8.2% | 0.27 | 36.1% | 36.7% | 0.3% (1.3) | -8.7% | -7.8% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | cash | 50 | 2.5% | -8.3% | 0.30 | 28.2% | 38.4% | 0.3% (1.6) | -7.9% | -8.8% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 49 | 2.4% | -8.3% | 0.25 | 49.2% | 37.7% | 0.2% (1.2) | -8.7% | -8.0% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | cash | 39 | 2.3% | -8.5% | 0.24 | 45.3% | 36.1% | 0.2% (1.1) | -9.2% | -7.8% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 25 | 2.3% | -8.5% | 0.26 | 36.6% | 38.0% | 0.5% (1.4) | -7.3% | -9.7% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | cash | 59 | 2.3% | -8.5% | 0.25 | 43.0% | 37.5% | 0.2% (1.4) | -8.4% | -8.7% |
| momentum | 7% stop, ride above 50-day avg | 5 | cash | 23 | 1.9% | -8.9% | 0.22 | 38.4% | 37.2% | 0.5% (1.2) | -8.7% | -8.9% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 63 | 1.9% | -8.9% | 0.25 | 29.0% | 38.0% | 0.2% (1.5) | -8.4% | -9.5% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 43 | 1.8% | -9.0% | 0.21 | 32.0% | 37.9% | 0.2% (1.1) | -7.3% | -10.7% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 74 | 1.5% | -9.3% | 0.19 | 40.8% | 37.4% | 0.1% (1.0) | -9.8% | -8.9% |
| momentum | 7% stop, ride above 20-day avg | 3 | cash | 26 | 1.3% | -9.5% | 0.16 | 52.1% | 39.9% | 0.2% (0.7) | -9.1% | -10.1% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 31 | 0.6% | -10.1% | 0.11 | 45.3% | 41.2% | 0.1% (0.5) | -7.4% | -13.2% |
| momentum | 7% stop, ride above 20-day avg | 5 | cash | 35 | 0.4% | -10.4% | 0.09 | 38.9% | 39.5% | 0.1% (0.4) | -8.4% | -12.8% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 41 | -0.3% | -11.1% | 0.00 | 41.0% | 39.8% | -0.0% (-0.1) | -7.7% | -14.9% |

Walk forward (idle cash in cash): best on the first half was "momentum / 20% trailing stop / 3 slots" at 5.1% a year vs SPY; on the second half it did -2.3%, rank 1 of 48. 0 of 48 variants beat SPY in the second half.

Walk forward (idle cash in SPY): best on the first half was "52-week high / 20% trailing stop / 3 slots" at 5.0% a year vs SPY; on the second half it did -5.9%, rank 44 of 48. 6 of 48 variants beat SPY in the second half.

## BIG2014: 20 names, 2015 to 2026

SPY held: 13.6% a year, Sharpe 0.82, worst drop 33.7%. First half to 2021: 12.6%; second half: 14.5%.

| Entry | Exit | Slots | Idle cash | Trades/yr | Yearly | vs SPY | Sharpe | Worst drop | Won | Avg trade (t) | 1st half | 2nd half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| momentum | 10% trailing stop | 3 | SPY | 7 | 20.9% | 7.3% | 1.07 | 34.3% | 45.6% | 8.2% (2.9) | -5.5% | 21.1% |
| momentum | 7% stop, ride above 50-day avg | 3 | SPY | 14 | 19.9% | 6.4% | 0.99 | 37.5% | 39.9% | 3.0% (2.7) | -2.8% | 15.5% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 16 | 18.8% | 5.2% | 0.98 | 34.8% | 43.0% | 2.3% (3.0) | -3.7% | 12.5% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | SPY | 17 | 17.7% | 4.2% | 0.92 | 35.8% | 38.3% | 2.6% (2.7) | -0.7% | 10.8% |
| momentum | 20% trailing stop | 3 | SPY | 3 | 17.7% | 4.1% | 0.89 | 32.5% | 51.6% | 16.4% (2.3) | -4.8% | 13.8% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | SPY | 25 | 17.6% | 4.1% | 0.99 | 34.9% | 42.9% | 2.5% (3.4) | -0.9% | 10.7% |
| momentum | 10% trailing stop | 5 | SPY | 11 | 17.5% | 4.0% | 1.02 | 33.0% | 41.5% | 5.8% (2.8) | -2.7% | 11.3% |
| momentum | 7% stop, ride above 50-day avg | 5 | SPY | 22 | 17.4% | 3.9% | 0.96 | 36.4% | 41.4% | 2.4% (2.9) | -2.5% | 10.8% |
| 52-week high | 10% trailing stop | 3 | SPY | 7 | 17.1% | 3.6% | 0.93 | 35.7% | 42.4% | 5.7% (2.3) | -2.7% | 7.1% |
| momentum | 20% trailing stop | 5 | SPY | 3 | 17.1% | 3.5% | 1.00 | 25.9% | 54.3% | 20.9% (2.5) | -0.7% | 8.8% |
| 50-day high, above 200-day | 10% trailing stop | 3 | SPY | 8 | 17.1% | 3.5% | 0.93 | 34.3% | 46.2% | 5.6% (2.2) | -4.6% | 9.8% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 27 | 16.8% | 3.2% | 0.97 | 35.3% | 41.2% | 1.9% (3.5) | -2.1% | 9.7% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | SPY | 23 | 16.5% | 2.9% | 0.93 | 34.9% | 42.4% | 2.2% (3.0) | -1.2% | 8.2% |
| momentum | 10% trailing stop | 3 | cash | 7 | 16.4% | 2.8% | 1.05 | 24.4% | 45.6% | 8.2% (2.9) | -9.3% | 15.5% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 20 | 16.2% | 2.6% | 0.86 | 37.3% | 39.7% | 1.8% (2.7) | -2.5% | 10.2% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 25 | 15.8% | 2.3% | 0.90 | 34.9% | 42.0% | 1.7% (2.8) | -2.5% | 7.7% |
| 50-day high, above 200-day | 10% trailing stop | 5 | SPY | 13 | 15.8% | 2.3% | 0.92 | 35.4% | 45.4% | 4.8% (2.7) | -2.3% | 6.0% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | SPY | 29 | 15.5% | 2.0% | 0.89 | 35.2% | 40.4% | 2.2% (3.0) | -3.4% | 7.6% |
| 52-week high | 10% trailing stop | 5 | SPY | 12 | 14.8% | 1.2% | 0.88 | 34.7% | 40.0% | 3.9% (2.4) | -1.0% | 4.3% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 31 | 14.7% | 1.1% | 0.86 | 35.1% | 42.3% | 1.6% (3.2) | -2.1% | 6.0% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | SPY | 18 | 14.5% | 0.9% | 0.78 | 34.7% | 38.7% | 2.2% (2.5) | -3.0% | 6.0% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 34 | 14.5% | 0.9% | 0.85 | 36.7% | 39.5% | 1.6% (3.3) | -3.7% | 5.2% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | SPY | 16 | 13.9% | 0.3% | 0.76 | 37.5% | 37.2% | 1.8% (2.0) | -3.8% | 6.2% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 19 | 13.8% | 0.3% | 0.77 | 37.6% | 39.4% | 1.6% (2.4) | -4.7% | 6.0% |
| 50-day high, above 200-day | 20% trailing stop | 3 | SPY | 1 | 13.5% | -0.1% | 0.80 | 25.0% | 53.8% | 31.0% (1.5) | 3.6% | -1.8% |
| momentum | 7% stop, ride above 20-day avg | 3 | SPY | 27 | 13.4% | -0.2% | 0.74 | 34.8% | 40.3% | 0.9% (1.8) | -1.6% | 1.2% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 59 | 13.3% | -0.2% | 0.80 | 35.9% | 39.9% | 0.4% (2.0) | -4.3% | 4.8% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | SPY | 47 | 13.3% | -0.3% | 0.79 | 35.4% | 38.4% | 0.5% (1.7) | -3.7% | 4.0% |
| momentum, no volume | 10% trailing stop | 3 | SPY | 8 | 13.2% | -0.4% | 0.76 | 36.5% | 44.0% | 4.9% (2.2) | -3.1% | -0.7% |
| momentum | 7% stop, ride above 50-day avg | 3 | cash | 14 | 13.2% | -0.4% | 0.87 | 19.8% | 39.9% | 3.0% (2.7) | -9.7% | 9.2% |
| momentum | 20% trailing stop | 5 | cash | 3 | 12.8% | -0.7% | 0.88 | 20.0% | 54.3% | 20.9% (2.5) | -4.9% | 4.2% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | SPY | 53 | 12.8% | -0.8% | 0.76 | 34.6% | 39.2% | 0.6% (2.0) | -1.9% | 0.8% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 22 | 12.8% | -0.8% | 0.73 | 35.7% | 38.1% | 1.5% (2.5) | -3.6% | 3.5% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | cash | 17 | 12.8% | -0.8% | 0.81 | 23.8% | 38.3% | 2.6% (2.7) | -5.1% | 4.9% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | SPY | 38 | 12.7% | -0.9% | 0.72 | 36.7% | 39.7% | 0.8% (2.2) | 0.5% | -1.1% |
| momentum | 20% trailing stop | 3 | cash | 3 | 12.7% | -0.9% | 0.75 | 24.9% | 51.6% | 16.4% (2.3) | -8.9% | 7.5% |
| momentum | 10% trailing stop | 5 | cash | 11 | 12.6% | -0.9% | 1.01 | 16.4% | 41.5% | 5.8% (2.8) | -7.7% | 6.3% |
| 52-week high | 10% trailing stop | 3 | cash | 7 | 12.6% | -1.0% | 0.85 | 24.2% | 42.4% | 5.7% (2.3) | -7.9% | 3.1% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 68 | 12.4% | -1.2% | 0.75 | 35.1% | 39.5% | 0.4% (2.1) | -3.2% | 1.9% |
| 50-day high, above 200-day | 10% trailing stop | 3 | cash | 8 | 12.3% | -1.3% | 0.81 | 24.6% | 46.2% | 5.6% (2.2) | -9.9% | 5.3% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 46 | 12.1% | -1.5% | 0.69 | 36.0% | 39.3% | 0.5% (2.0) | -3.1% | 0.8% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | cash | 18 | 12.1% | -1.5% | 0.78 | 26.7% | 38.7% | 2.2% (2.5) | -4.3% | 2.3% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | SPY | 33 | 12.1% | -1.5% | 0.69 | 37.4% | 39.7% | 0.6% (1.5) | -5.9% | 4.0% |
| 52-week high | 20% trailing stop | 5 | SPY | 3 | 12.0% | -1.6% | 0.75 | 31.0% | 50.0% | 15.6% (1.8) | -1.5% | 0.5% |
| 50-day high, above 200-day | 20% trailing stop | 3 | cash | 1 | 11.9% | -1.6% | 0.76 | 23.9% | 53.8% | 31.0% (1.5) | 2.0% | -3.4% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | cash | 25 | 11.9% | -1.7% | 0.91 | 18.8% | 42.9% | 2.5% (3.4) | -6.7% | 4.6% |
| momentum, no volume | 10% trailing stop | 5 | SPY | 13 | 11.9% | -1.7% | 0.74 | 33.0% | 41.8% | 3.4% (2.3) | -4.5% | -1.0% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 16 | 11.8% | -1.8% | 0.84 | 21.9% | 43.0% | 2.3% (3.0) | -10.0% | 4.7% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 32 | 11.7% | -1.8% | 0.68 | 34.1% | 42.1% | 0.7% (2.2) | -2.0% | -1.0% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | cash | 29 | 11.7% | -1.9% | 0.87 | 21.3% | 40.4% | 2.2% (3.0) | -6.2% | 2.3% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | SPY | 60 | 11.5% | -2.1% | 0.70 | 35.3% | 38.5% | 0.6% (2.2) | -3.1% | -0.8% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 20 | 11.3% | -2.2% | 0.76 | 25.8% | 39.7% | 1.8% (2.7) | -6.5% | 4.2% |
| momentum, no volume | 10% trailing stop | 3 | cash | 8 | 11.3% | -2.2% | 0.77 | 34.5% | 44.0% | 4.9% (2.2) | -4.6% | -2.9% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 42 | 11.2% | -2.4% | 0.66 | 37.4% | 40.7% | 0.4% (1.5) | -6.0% | 2.3% |
| 50-day high, above 200-day | 20% trailing stop | 5 | SPY | 3 | 11.2% | -2.4% | 0.72 | 26.3% | 53.1% | 15.4% (1.7) | 0.2% | -4.5% |
| 50-day high, above 200-day | 10% trailing stop | 5 | cash | 13 | 11.0% | -2.6% | 0.84 | 20.5% | 45.4% | 4.8% (2.7) | -7.1% | 1.0% |
| momentum | 7% stop, ride above 20-day avg | 5 | SPY | 37 | 10.6% | -2.9% | 0.65 | 34.4% | 38.0% | 0.5% (1.3) | -4.7% | -0.8% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 34 | 10.6% | -3.0% | 0.83 | 20.8% | 39.5% | 1.6% (3.3) | -6.1% | -0.2% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 77 | 10.3% | -3.3% | 0.64 | 35.8% | 39.3% | 0.4% (2.3) | -3.5% | -3.2% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | SPY | 37 | 10.3% | -3.3% | 0.61 | 36.0% | 37.5% | 0.5% (1.2) | -2.5% | -3.0% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 50 | 10.3% | -3.3% | 0.61 | 36.7% | 40.3% | 0.5% (2.1) | -1.6% | -3.8% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 27 | 10.2% | -3.3% | 0.89 | 16.0% | 41.2% | 1.9% (3.5) | -7.8% | 1.7% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 22 | 10.1% | -3.5% | 0.70 | 24.5% | 38.1% | 1.5% (2.5) | -5.1% | -0.6% |
| momentum | 7% stop, ride above 50-day avg | 5 | cash | 22 | 9.9% | -3.7% | 0.83 | 18.0% | 41.4% | 2.4% (2.9) | -9.9% | 2.8% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | cash | 38 | 9.5% | -4.1% | 0.67 | 19.6% | 39.7% | 0.8% (2.2) | -1.9% | -5.4% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | cash | 23 | 9.4% | -4.2% | 0.77 | 20.1% | 42.4% | 2.2% (3.0) | -7.9% | 0.6% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 31 | 9.3% | -4.3% | 0.76 | 18.4% | 42.3% | 1.6% (3.2) | -7.4% | -0.0% |
| 50-day high, above 200-day | 20% trailing stop | 5 | cash | 3 | 9.3% | -4.3% | 0.67 | 22.4% | 53.1% | 15.4% (1.7) | -2.2% | -6.4% |
| 52-week high | 10% trailing stop | 5 | cash | 12 | 8.8% | -4.8% | 0.71 | 19.0% | 40.0% | 3.9% (2.4) | -7.1% | -2.2% |
| 52-week high | 20% trailing stop | 5 | cash | 3 | 8.8% | -4.8% | 0.64 | 22.1% | 50.0% | 15.6% (1.8) | -5.3% | -2.8% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 19 | 8.8% | -4.8% | 0.64 | 26.6% | 39.4% | 1.6% (2.4) | -9.0% | -0.1% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 43 | 8.8% | -4.8% | 0.56 | 34.6% | 39.0% | 0.2% (0.8) | -5.8% | -3.6% |
| momentum, no volume | 10% trailing stop | 5 | cash | 13 | 8.6% | -5.0% | 0.69 | 30.8% | 41.8% | 3.4% (2.3) | -6.6% | -5.6% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | cash | 16 | 8.4% | -5.2% | 0.58 | 26.5% | 37.2% | 1.8% (2.0) | -8.7% | -0.2% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 25 | 7.7% | -5.9% | 0.69 | 17.4% | 42.0% | 1.7% (2.8) | -10.1% | -1.6% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 50 | 7.4% | -6.2% | 0.56 | 20.3% | 40.3% | 0.5% (2.1) | -3.6% | -7.8% |
| momentum, no volume | 20% trailing stop | 5 | SPY | 3 | 7.4% | -6.2% | 0.53 | 27.9% | 36.8% | 8.3% (1.5) | -6.4% | -2.7% |
| momentum | 7% stop, ride above 20-day avg | 3 | cash | 27 | 7.0% | -6.6% | 0.56 | 31.2% | 40.3% | 0.9% (1.8) | -8.5% | -4.9% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | cash | 60 | 6.8% | -6.7% | 0.59 | 14.9% | 38.5% | 0.6% (2.2) | -7.1% | -6.4% |
| momentum, no volume | 20% trailing stop | 3 | SPY | 2 | 6.8% | -6.8% | 0.48 | 29.0% | 40.0% | 6.1% (0.9) | -4.4% | -5.7% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 46 | 6.7% | -6.9% | 0.51 | 28.1% | 39.3% | 0.5% (2.0) | -8.7% | -4.6% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 32 | 6.6% | -7.0% | 0.57 | 29.8% | 42.1% | 0.7% (2.2) | -8.4% | -5.1% |
| momentum, no volume | 20% trailing stop | 3 | cash | 2 | 6.4% | -7.2% | 0.48 | 27.3% | 40.0% | 6.1% (0.9) | -5.0% | -5.9% |
| momentum, no volume | 20% trailing stop | 5 | cash | 3 | 6.0% | -7.5% | 0.49 | 29.6% | 36.8% | 8.3% (1.5) | -8.1% | -4.1% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 77 | 6.0% | -7.5% | 0.54 | 20.8% | 39.3% | 0.4% (2.3) | -6.9% | -8.5% |
| 52-week high | 20% trailing stop | 3 | SPY | 2 | 6.0% | -7.6% | 0.42 | 30.1% | 38.9% | 3.9% (0.7) | -8.7% | -3.4% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | cash | 53 | 5.6% | -7.9% | 0.53 | 24.1% | 39.2% | 0.6% (2.0) | -9.6% | -6.0% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | cash | 33 | 5.1% | -8.4% | 0.43 | 27.4% | 39.7% | 0.6% (1.5) | -12.0% | -4.1% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 68 | 5.0% | -8.6% | 0.49 | 23.6% | 39.5% | 0.4% (2.1) | -10.8% | -5.6% |
| 52-week high | 20% trailing stop | 3 | cash | 2 | 4.6% | -8.9% | 0.37 | 26.2% | 38.9% | 3.9% (0.7) | -10.7% | -4.4% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | cash | 37 | 4.5% | -9.1% | 0.37 | 32.9% | 37.5% | 0.5% (1.2) | -8.7% | -8.6% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 59 | 4.4% | -9.1% | 0.47 | 24.5% | 39.9% | 0.4% (2.0) | -12.8% | -4.8% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 42 | 4.3% | -9.3% | 0.38 | 25.1% | 40.7% | 0.4% (1.5) | -12.2% | -5.6% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | cash | 47 | 4.3% | -9.3% | 0.44 | 26.2% | 38.4% | 0.5% (1.7) | -12.7% | -5.3% |
| momentum | 7% stop, ride above 20-day avg | 5 | cash | 37 | 3.0% | -10.6% | 0.34 | 33.7% | 38.0% | 0.5% (1.3) | -12.7% | -8.4% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 43 | 1.3% | -12.2% | 0.19 | 31.8% | 39.0% | 0.2% (0.8) | -13.9% | -10.7% |

Walk forward (idle cash in cash): best on the first half was "50-day high, above 200-day / 20% trailing stop / 3 slots" at 2.0% a year vs SPY; on the second half it did -3.4%, rank 27 of 48. 17 of 48 variants beat SPY in the second half.

Walk forward (idle cash in SPY): best on the first half was "50-day high, above 200-day / 20% trailing stop / 3 slots" at 3.6% a year vs SPY; on the second half it did -1.8%, rank 40 of 48. 33 of 48 variants beat SPY in the second half.

## RICHIE19 (picked with hindsight, for comparison only): 19 names, 1999 to 2026

SPY held: 8.5% a year, Sharpe 0.52, worst drop 55.2%. First half to 2013: 2.4%; second half: 14.7%.

| Entry | Exit | Slots | Idle cash | Trades/yr | Yearly | vs SPY | Sharpe | Worst drop | Won | Avg trade (t) | 1st half | 2nd half |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| momentum | 20% trailing stop | 3 | SPY | 2 | 16.1% | 7.7% | 0.79 | 54.5% | 52.6% | 26.5% (3.5) | 8.0% | 6.8% |
| 52-week high | 20% trailing stop | 3 | SPY | 2 | 16.0% | 7.5% | 0.77 | 55.9% | 51.7% | 22.7% (3.5) | 9.7% | 3.3% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 16 | 15.0% | 6.5% | 0.72 | 58.4% | 42.0% | 2.2% (3.9) | 5.0% | 8.3% |
| momentum | 20% trailing stop | 5 | SPY | 4 | 14.7% | 6.2% | 0.77 | 55.3% | 50.0% | 21.9% (4.3) | 5.1% | 6.9% |
| momentum | 20% trailing stop | 3 | cash | 2 | 14.4% | 5.9% | 0.82 | 42.0% | 52.6% | 26.5% (3.5) | 7.6% | 3.3% |
| 50-day high, above 200-day | 20% trailing stop | 5 | SPY | 3 | 13.8% | 5.3% | 0.72 | 57.1% | 51.6% | 24.0% (4.1) | 7.6% | 1.6% |
| 52-week high | 20% trailing stop | 3 | cash | 2 | 13.5% | 5.0% | 0.79 | 36.5% | 51.7% | 22.7% (3.5) | 8.2% | 0.2% |
| 52-week high | 20% trailing stop | 5 | SPY | 3 | 13.4% | 4.9% | 0.71 | 59.0% | 56.1% | 22.3% (4.1) | 6.1% | 2.4% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 25 | 13.1% | 4.6% | 0.68 | 55.0% | 39.8% | 1.6% (3.7) | 4.8% | 4.1% |
| 50-day high, above 200-day | 20% trailing stop | 3 | SPY | 2 | 13.1% | 4.6% | 0.67 | 55.3% | 49.1% | 20.9% (3.1) | 11.2% | -0.2% |
| momentum | 20% trailing stop | 5 | cash | 4 | 12.8% | 4.4% | 0.81 | 39.0% | 50.0% | 21.9% (4.3) | 5.1% | 3.0% |
| 52-week high | 10% trailing stop | 3 | SPY | 7 | 12.5% | 4.0% | 0.63 | 58.6% | 42.7% | 4.8% (2.8) | 1.6% | 6.5% |
| 50-day high, above 200-day | 20% trailing stop | 5 | cash | 3 | 12.4% | 3.9% | 0.78 | 33.7% | 51.6% | 24.0% (4.1) | 8.0% | -1.4% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | SPY | 23 | 12.3% | 3.9% | 0.64 | 61.1% | 39.7% | 2.2% (3.7) | 3.0% | 4.8% |
| momentum | 7% stop, ride above 50-day avg | 5 | SPY | 22 | 12.1% | 3.6% | 0.63 | 57.1% | 38.8% | 1.8% (2.9) | 2.1% | 5.0% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 27 | 11.9% | 3.4% | 0.64 | 55.8% | 40.5% | 1.7% (4.4) | 3.2% | 3.7% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 33 | 11.9% | 3.4% | 0.63 | 52.9% | 38.9% | 1.4% (4.1) | 3.0% | 2.9% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | SPY | 14 | 11.8% | 3.3% | 0.59 | 55.9% | 38.6% | 1.9% (2.3) | 3.0% | 3.6% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | SPY | 24 | 11.8% | 3.3% | 0.64 | 55.4% | 40.5% | 1.6% (4.1) | 3.5% | 2.9% |
| 50-day high, above 200-day | 20% trailing stop | 3 | cash | 2 | 11.6% | 3.2% | 0.69 | 35.6% | 49.1% | 20.9% (3.1) | 11.5% | -3.3% |
| momentum | 7% stop, ride above 50-day avg | 3 | SPY | 15 | 11.5% | 3.1% | 0.58 | 68.9% | 37.6% | 1.9% (2.3) | -0.1% | 6.8% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | SPY | 19 | 11.3% | 2.8% | 0.56 | 63.7% | 35.1% | 1.7% (2.7) | 4.6% | 1.1% |
| 52-week high | 20% trailing stop | 5 | cash | 3 | 11.3% | 2.8% | 0.77 | 30.6% | 56.1% | 22.3% (4.1) | 5.3% | -0.7% |
| momentum | 10% trailing stop | 5 | SPY | 13 | 11.3% | 2.8% | 0.62 | 56.9% | 40.3% | 3.5% (3.3) | -1.3% | 7.0% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | SPY | 16 | 11.3% | 2.8% | 0.56 | 66.7% | 38.1% | 2.0% (2.5) | 1.3% | 4.4% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | SPY | 21 | 11.2% | 2.8% | 0.61 | 54.8% | 39.3% | 1.7% (2.9) | 3.0% | 2.5% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | SPY | 29 | 11.1% | 2.6% | 0.59 | 62.2% | 37.2% | 1.6% (3.4) | 2.5% | 2.8% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | SPY | 36 | 11.1% | 2.6% | 0.57 | 67.9% | 39.1% | 0.8% (3.0) | 4.8% | 0.5% |
| 52-week high | 10% trailing stop | 5 | SPY | 11 | 10.8% | 2.4% | 0.59 | 55.6% | 41.9% | 4.0% (3.3) | 2.4% | 2.4% |
| 50-day high, above 200-day | 10% trailing stop | 3 | SPY | 8 | 10.7% | 2.3% | 0.57 | 57.2% | 40.7% | 4.3% (2.8) | 1.0% | 3.1% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 21 | 10.6% | 2.1% | 0.55 | 58.9% | 36.9% | 1.4% (3.1) | 2.2% | -0.1% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 16 | 10.6% | 2.1% | 0.66 | 35.5% | 42.0% | 2.2% (3.9) | 2.1% | 2.2% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 16 | 10.6% | 2.1% | 0.56 | 57.6% | 40.0% | 1.4% (2.9) | 2.0% | 2.1% |
| 50-day high, above 200-day | 10% trailing stop | 5 | SPY | 13 | 10.6% | 2.1% | 0.58 | 56.8% | 41.5% | 3.9% (3.5) | 1.9% | 2.2% |
| momentum, no volume | 20% trailing stop | 5 | SPY | 4 | 10.5% | 2.0% | 0.60 | 55.5% | 40.9% | 13.6% (3.1) | 4.0% | -0.9% |
| momentum | 10% trailing stop | 3 | SPY | 8 | 10.2% | 1.7% | 0.55 | 57.8% | 39.3% | 3.3% (2.3) | -2.2% | 6.2% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | SPY | 18 | 10.0% | 1.5% | 0.53 | 56.5% | 38.1% | 1.4% (2.9) | 0.1% | 2.5% |
| momentum, no volume | 20% trailing stop | 3 | SPY | 2 | 9.7% | 1.2% | 0.55 | 49.5% | 43.1% | 12.8% (2.6) | 4.5% | -2.9% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 30 | 9.6% | 1.1% | 0.53 | 53.7% | 40.9% | 0.4% (2.1) | 0.9% | 1.6% |
| momentum | 7% stop, ride above 20-day avg | 3 | SPY | 25 | 9.4% | 1.0% | 0.51 | 60.9% | 38.5% | 0.6% (1.9) | 2.7% | -0.9% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | SPY | 30 | 9.0% | 0.5% | 0.49 | 69.5% | 40.8% | 0.7% (2.7) | 1.2% | -0.5% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | SPY | 44 | 9.0% | 0.5% | 0.51 | 65.2% | 39.2% | 0.6% (2.9) | 0.6% | 0.2% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | SPY | 39 | 8.9% | 0.5% | 0.52 | 56.9% | 39.9% | 0.5% (2.5) | 0.9% | -0.1% |
| momentum, no volume | 10% trailing stop | 5 | SPY | 16 | 8.9% | 0.4% | 0.52 | 55.2% | 38.9% | 2.4% (3.1) | 0.1% | 1.1% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 46 | 8.8% | 0.4% | 0.49 | 54.4% | 38.6% | 0.4% (2.6) | 1.5% | -0.8% |
| 52-week high | 10% trailing stop | 3 | cash | 7 | 8.8% | 0.3% | 0.59 | 45.9% | 42.7% | 4.8% (2.8) | -0.1% | 0.4% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | SPY | 27 | 8.8% | 0.3% | 0.49 | 59.5% | 40.0% | 0.6% (2.2) | 1.7% | -1.2% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 50 | 8.7% | 0.2% | 0.51 | 55.5% | 39.1% | 0.4% (2.4) | 0.8% | -0.5% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 5 | cash | 23 | 8.6% | 0.1% | 0.62 | 52.3% | 39.7% | 2.2% (3.7) | 1.9% | -1.7% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 58 | 8.5% | 0.0% | 0.50 | 58.8% | 38.9% | 0.4% (3.0) | 0.9% | -1.0% |
| 50-day high, above 200-day | 10% trailing stop | 3 | cash | 8 | 8.5% | 0.0% | 0.57 | 54.7% | 40.7% | 4.3% (2.8) | 1.4% | -2.1% |
| momentum, no volume | 10% trailing stop | 3 | SPY | 10 | 8.4% | -0.0% | 0.48 | 69.0% | 38.2% | 2.3% (2.5) | -3.7% | 4.7% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | SPY | 54 | 8.4% | -0.1% | 0.49 | 68.1% | 38.9% | 0.5% (2.7) | -0.8% | 0.6% |
| momentum, no volume | 20% trailing stop | 3 | cash | 2 | 8.3% | -0.2% | 0.53 | 41.4% | 43.1% | 12.8% (2.6) | 3.7% | -4.6% |
| momentum | 7% stop, ride above 20-day avg | 5 | SPY | 34 | 8.3% | -0.2% | 0.48 | 58.7% | 37.4% | 0.4% (1.6) | 1.0% | -1.6% |
| momentum, no volume | 7% stop, ride above 50-day avg | 3 | cash | 19 | 8.3% | -0.2% | 0.49 | 62.2% | 35.1% | 1.7% (2.7) | 2.4% | -2.8% |
| momentum, no volume | 20% trailing stop | 5 | cash | 4 | 8.3% | -0.2% | 0.56 | 49.0% | 40.9% | 13.6% (3.1) | 2.4% | -3.4% |
| 50-day high, above 200-day | 10% trailing stop | 5 | cash | 13 | 8.1% | -0.3% | 0.60 | 48.8% | 41.5% | 3.9% (3.5) | 2.2% | -3.3% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 33 | 8.1% | -0.4% | 0.57 | 44.9% | 38.9% | 1.4% (4.1) | 0.8% | -2.4% |
| 50-day high, above 200-day | 7% stop, ride above 50-day avg | 3 | cash | 16 | 8.1% | -0.4% | 0.50 | 63.0% | 38.1% | 2.0% (2.5) | 0.4% | -1.5% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 27 | 8.0% | -0.4% | 0.62 | 43.6% | 40.5% | 1.7% (4.4) | 2.3% | -3.4% |
| momentum, no volume | 7% stop, ride above 20-day avg | 3 | cash | 36 | 8.0% | -0.5% | 0.51 | 64.0% | 39.1% | 0.8% (3.0) | 3.0% | -4.1% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 35 | 8.0% | -0.5% | 0.47 | 57.0% | 38.8% | 0.4% (2.0) | -0.6% | -0.5% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 40 | 7.9% | -0.6% | 0.47 | 53.8% | 39.0% | 0.3% (1.4) | -0.3% | -0.8% |
| momentum, no volume | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 21 | 7.9% | -0.6% | 0.49 | 51.3% | 36.9% | 1.4% (3.1) | 0.4% | -3.8% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | SPY | 70 | 7.9% | -0.6% | 0.47 | 62.0% | 38.5% | 0.3% (2.6) | -0.6% | -0.6% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | SPY | 40 | 7.8% | -0.7% | 0.45 | 65.5% | 38.9% | 0.4% (2.4) | -1.2% | -0.2% |
| momentum | 10% trailing stop | 5 | cash | 13 | 7.8% | -0.7% | 0.60 | 47.1% | 40.3% | 3.5% (3.3) | -2.8% | 1.1% |
| momentum, no volume | 7% stop, ride above 50-day avg | 5 | cash | 29 | 7.5% | -1.0% | 0.52 | 57.5% | 37.2% | 1.6% (3.4) | -0.1% | -2.2% |
| momentum | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 25 | 7.4% | -1.1% | 0.59 | 30.9% | 39.8% | 1.6% (3.7) | 1.8% | -4.6% |
| 52-week high | 10% trailing stop | 5 | cash | 11 | 7.3% | -1.2% | 0.58 | 29.2% | 41.9% | 4.0% (3.3) | 1.5% | -4.0% |
| 52-week high | 7% stop, ride above 50-day avg | 3 | cash | 14 | 7.0% | -1.5% | 0.47 | 47.0% | 38.6% | 1.9% (2.3) | 0.5% | -3.6% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 5 | cash | 24 | 7.0% | -1.5% | 0.60 | 23.5% | 40.5% | 1.6% (4.1) | 1.4% | -4.6% |
| momentum | 10% trailing stop | 3 | cash | 8 | 6.9% | -1.6% | 0.49 | 51.0% | 39.3% | 3.3% (2.3) | -4.1% | 0.6% |
| momentum | 7% stop, ride above 50-day avg | 3 | cash | 15 | 6.7% | -1.7% | 0.45 | 65.6% | 37.6% | 1.9% (2.3) | -3.9% | 0.7% |
| 50-day high, above 200-day | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 18 | 6.6% | -1.9% | 0.47 | 52.0% | 38.1% | 1.4% (2.9) | -1.0% | -3.3% |
| momentum | 7% stop, ride above 50-day avg | 5 | cash | 22 | 6.5% | -2.0% | 0.50 | 48.8% | 38.8% | 1.8% (2.9) | -1.0% | -3.3% |
| 52-week high | 10% stop, 30% target, 60 days, 50-day avg | 3 | cash | 16 | 6.5% | -2.0% | 0.47 | 36.6% | 40.0% | 1.4% (2.9) | 0.3% | -4.7% |
| momentum, no volume | 10% trailing stop | 5 | cash | 16 | 6.4% | -2.1% | 0.47 | 53.2% | 38.9% | 2.4% (3.1) | -1.5% | -2.6% |
| 52-week high | 7% stop, ride above 50-day avg | 5 | cash | 21 | 6.2% | -2.3% | 0.51 | 32.5% | 39.3% | 1.7% (2.9) | 0.5% | -5.2% |
| momentum, no volume | 10% trailing stop | 3 | cash | 10 | 6.1% | -2.4% | 0.42 | 66.9% | 38.2% | 2.3% (2.5) | -5.4% | 1.5% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 3 | cash | 30 | 5.7% | -2.8% | 0.43 | 60.5% | 40.8% | 0.7% (2.7) | 1.1% | -7.1% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 46 | 5.5% | -3.0% | 0.41 | 51.2% | 38.6% | 0.4% (2.6) | -0.7% | -5.5% |
| 50-day high, above 200-day | 7% stop, ride above 20-day avg | 5 | cash | 44 | 4.9% | -3.6% | 0.44 | 49.6% | 39.2% | 0.6% (2.9) | -0.1% | -7.4% |
| momentum, no volume | 7% stop, ride above 20-day avg | 5 | cash | 54 | 4.8% | -3.7% | 0.40 | 58.8% | 38.9% | 0.5% (2.7) | -2.8% | -4.8% |
| 52-week high | 7% stop, ride above 20-day avg | 3 | cash | 27 | 4.5% | -4.0% | 0.37 | 47.9% | 40.0% | 0.6% (2.2) | 0.5% | -8.8% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 40 | 4.4% | -4.1% | 0.37 | 57.3% | 38.9% | 0.4% (2.4) | -1.7% | -6.8% |
| 50-day high, above 200-day | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 58 | 4.4% | -4.1% | 0.42 | 41.2% | 38.9% | 0.4% (3.0) | 0.0% | -8.5% |
| momentum, no volume | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 70 | 4.2% | -4.3% | 0.37 | 51.0% | 38.5% | 0.3% (2.6) | -2.8% | -6.0% |
| 52-week high | 7% stop, ride above 20-day avg | 5 | cash | 39 | 3.8% | -4.7% | 0.38 | 36.1% | 39.9% | 0.5% (2.5) | -0.5% | -9.1% |
| momentum | 7% stop, ride above 20-day avg | 3 | cash | 25 | 3.8% | -4.7% | 0.32 | 57.1% | 38.5% | 0.6% (1.9) | -0.5% | -9.1% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 30 | 3.7% | -4.8% | 0.34 | 45.1% | 40.9% | 0.4% (2.1) | -2.1% | -7.5% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 3 | cash | 35 | 3.4% | -5.1% | 0.32 | 36.6% | 38.8% | 0.4% (2.0) | -1.6% | -8.7% |
| 52-week high | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 50 | 3.3% | -5.2% | 0.35 | 24.9% | 39.1% | 0.4% (2.4) | -0.9% | -9.7% |
| momentum | 7% stop, ride above 20-day avg | 5 | cash | 34 | 2.3% | -6.2% | 0.25 | 42.5% | 37.4% | 0.4% (1.6) | -1.3% | -11.4% |
| momentum | playbook (7% stop, 14% target, 20 days, 20-day avg) | 5 | cash | 40 | 1.8% | -6.7% | 0.22 | 31.5% | 39.0% | 0.3% (1.4) | -2.7% | -11.0% |

Walk forward (idle cash in cash): best on the first half was "50-day high, above 200-day / 20% trailing stop / 3 slots" at 11.5% a year vs SPY; on the second half it did -3.3%, rank 21 of 48. 9 of 48 variants beat SPY in the second half.

Walk forward (idle cash in SPY): best on the first half was "50-day high, above 200-day / 20% trailing stop / 3 slots" at 11.2% a year vs SPY; on the second half it did -0.2%, rank 36 of 48. 32 of 48 variants beat SPY in the second half.

## Summary

Variants on universes picked without hindsight: 288. Beat SPY over the whole period: 29. Higher Sharpe than SPY: 51.
