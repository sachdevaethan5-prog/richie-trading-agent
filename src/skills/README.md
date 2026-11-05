# Skills (optional)

Put your own skills here, one folder each with a `SKILL.md` in the Agent Skills format:

```
src/skills/my-skill/SKILL.md
---
name: my-skill
description: When Richie should read this, in one or two sentences.
---
Instructions Richie follows when the skill applies.
```

Richie sees each skill's name and description, and loads the instructions with its `skill_read` tool when one applies.
Skills never lift Richie's limits.

Included: `kalshi-parlays`, how Richie picks NFL legs, prices each one from the market, joins them for correlation, and
decides whether a combo quote is worth buying. Other skill folders you add are git-ignored, so your own know-how stays
private unless you choose to share it.
