# Phase 8 balance simulation

## What the harness measures

[`scripts/simulate-balance.mjs`](../scripts/simulate-balance.mjs) drives the production game engine through 2,000 deterministic trials, using seeds 1–2,000. Each trial starts with a real seeded egg-to-baby hatch, so the form and hatch traits vary naturally. The pet begins at level 1 with no Home upgrades or gear.

Each modeled session starts a standard dungeon run with three consumables: a Peppy Potion, a Brave Biscuit, and a Snug Snack. The player favors fights and treasure while healthy, chooses a rest below 72% HP, uses the healing item at or below 68% HP, guards bosses, and equips any collected item that improves a weighted stat score between sessions. Session one tries to bank safely at floor 9; some pets faint sooner. For session two, ordinary care is assumed to restore needs to 90%, and the run continues until faint or floor 40. This is a consistent, capable-player strategy—not a prediction of every player's choices.

## Results

| Measure | Outcome |
|---|---:|
| First-boss encounter within two sessions | 99.9% |
| First boss defeated within two sessions | 65.05% |
| First session safely banked | 59.7% |
| Median level at the start of session two | 5 |
| Session-two maximum floor, 10th / 25th percentile | 10 / 10 |
| Session-two maximum floor, median | **18** |
| Session-two maximum floor, 75th / 90th percentile | 20 / 20 |
| Reached floor 15 / floor 20 / floor 25 in session two | 63.95% / 38.5% / 2.1% |

This meets the intended shape: the floor-10 boss is encountered in about two sessions, the median second run reaches floor 18, and only a small share of trials get as far as floor 25. Boss clearance is not guaranteed; the 65.05% result leaves room for better gear, care, choices, and player skill to matter.

## Tuning applied

The JSON values in [`src/data/dungeon-rules.json`](../src/data/dungeon-rules.json) now use a 1.07-per-floor enemy scaling factor, boss multipliers of 1.25× HP and 0.9× ATK, and combat XP rewards of 12 / 16 / 30 for fights, elites, and bosses. These replace the earlier 1.09 slope, 2.5× / 1.3× boss multipliers, and 5 / 9 / 20 XP rewards. The floor-ten boss remains a meaningful risk while seeded trials show the requested 15–20 soft wall.

Reproduce the full pass from the repository root with:

```sh
node scripts/simulate-balance.mjs 2000
```

The script prints progress every 250 trials and exits nonzero if boss encounters fall below 95%, boss clears below 50%, or the median second-session floor leaves the 15–20 target range.
