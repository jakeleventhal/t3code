# Review usage

The Usage page combines Codex, Claude Code, and Grok Build activity from your connected
environments. It reads the providers' local session history and shows API-equivalent token cost,
processed tokens, cache savings, provider shares, and model breakdowns. Subscription billing is
separate from the raw token cost shown here.

Grok Build totals come from persisted session updates. Interactive turns that never wrote a
completed-turn record will not appear.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart. Refreshing rescans every connected environment and refetches model pricing on
each of them, so a newly released model that showed $0.00 gets a price without waiting for the daily
pricing update.

## Subscription limits

Below the chart, **Subscription limits** shows how much of each provider's rolling windows you have
used, such as the 5-hour and weekly limits, with the reset time for each. Codex reports its limits
live whenever the page loads, including any model family it meters separately. Claude Code only reports limits while a turn is running, so its
figures are as of the most recent Claude Code turn in T3 Code and the row says when it was updated.
Grok Build does not report limits. When several environments share one account, the freshest
reading is shown.
