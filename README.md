# Pocket Pal

A tiny, original virtual pet. Care for Pip in short moments; when you leave, the world pauses. This build includes **Phases 1–8**: the care loop, mini mode, life stages, stats, training, form collection, the endless dungeon, loot-driven equipment, Home meta-progression, daily trials, ascension, challenge modifiers, the Bestiary, local ghost battles, onboarding, and final polish.

**Live site:** <https://rom-bar.github.io/dundung/> (available after GitHub Pages is enabled and the first deployment succeeds).

## Play

Open the live site once while online, then Pocket Pal can load offline from the same browser. Feed Pip one of three snacks, play, tuck Pip in or wake them, clean up, and watch the egg hatch after one active minute. The life cycle continues through Baby, Teen, Adult, and Elder; each stage lasts 15, 45, 120, and 60 active minutes. Elder leaves a new egg with a trait and a small legacy stat bonus. Time never advances while away.

Care nudges Pip's next form without deciding it: the seeded evolution roll weighs play, rest, training, food, hygiene, and elemental food tags. Open **Forms** for the 20-entry Form Dex and past pets. After hatching, **Play a training game** opens Quick Spark (reaction), Echo Garden (memory), or Beat Bubbles (rhythm); results award XP and up to three points, subject to a per-stat training cap of two points per level. A 45-second active-time breather follows each completed game. The five stats and level appear in the growth panel.

On supported browsers, open **Mini** before switching apps to keep Pip's needs moving and use quick care actions in a floating window.

## Dungeon runs (Phase 4)

After Pip hatches, open **Dungeon** and pack up to three run-only consumables for healing, cleansing, or short stat boosts. Kitchen upgrades in Phase 6 can expand this to five slots. Each floor offers three different room paths; fights run automatically after choosing a tactic, while events, treasure, rest stops, and shops ask for a small decision. The floor-end screen is a natural stop: descend for more rewards, or leave to bank the run's coins and treasure-token value into Pip's coin balance. If Pip faints, half the run coins and a random half of tokens are kept, the pack is lost, and Pip returns with zero energy. Event boons and curses affect only that run. This phase has no equipment, crafting, or permanent item inventory; those begin in Phase 5.

## Gear and Workshop (Phase 5)

Open **Gear** to equip a Weapon, Armor, Hat, or Charm. Item stats are rolled deterministically from the floor, rarity, and item seed; rarity and affixes are shown on each card, and the Loadout tab compares the stat change before you equip an item. Matching sets add two-piece and four-piece bonuses. Equipped gear is drawn as rarity-colored pixel overlays on Pip.

The Bag holds up to 20 permanent items. Scrap unwanted gear for material, set an auto-scrap rarity threshold for future drops, upgrade items up to +10, or fuse three matching slot-and-rarity items into the next rarity. Higher-rarity fusion keeps one selected affix. Fusion uses a small, data-driven base Scrap fee that Workshop upgrades reduce. An Evolution Stone can be crafted from 30 Essence. These changes are locked while Pip is inside a run.

Dungeon gear is temporary until the run ends: choose **Take**, **Scrap**, or **Leave** for each drop, and shop purchases enter a separate run bag. A safe return banks gear and materials; a faint loses a random half of carried gear and half of carried materials. If a kept item cannot fit in the permanent bag, only that incoming item is salvaged for Scrap—existing items are never removed. This keeps the Phase 4 small run-coin and three-slot consumable economy intact while adding equipment in Phase 5.

## Home, achievements, and records (Phase 6)

Open **Home** to spend banked coins on five upgrades, each up to level 5. Each level costs `floor(50 × 1.6^current-level)` coins. Kitchen makes snacks stronger, adds pack slots at levels 2 and 4, and improves a free one-run meal (+10% to one selected stat at level 0, scaling by 2 percentage points per Kitchen level up to 20%). A meal is used only after a valid dungeon run starts.

Gym raises training caps and mini-game rewards. Workshop reduces equipment upgrade and fusion costs and adds five permanent bag spaces per level. Nursery improves stat legacy and passes down an extra trait at level 3. Library makes each discovered form add a small stat bonus; at level 1 it reveals a basic evolution clue, and at level 3 it shows the current top three form-weight hints without exposing undiscovered form names.

Achievements track Form Dex discoveries, depth, boss firsts, and gear sets. Coins, Essence, and keepsakes are awarded once when a goal is reached. **Records** shows lifetime room clears, bosses, safe returns, faints, best depth, coins banked, forms, and equipped set counts.

## Endless trials and friendly ghosts (Phase 7)

In **Home → Endless**, start one seeded Daily trial per UTC date; your personal best stays on this device, with no online leaderboard. Daily runs ignore your optional challenge modifiers. In standard runs, stack up to three of four opt-in modifiers for better rewards and tougher enemies. Reach floor 20, then five floors farther per ascension, to earn a permanent perk and raise the challenge. The Bestiary reveals enemies as you meet them and grants small coin bonuses at discovery milestones.

Use **Create my code** to share a bounded, versioned pet snapshot, then validate a code for a friendly deterministic ghost battle. Codes are checked and sanitized locally; battles are capped at 24 turns and never award items, coins, or online rankings. Save schema v6 adds Endless progress; earlier saves migrate automatically.

## Polish and balance (Phase 8)

The optional first-steps guide walks a new player from hatching Pip to opening the Dungeon, explains that time pauses when they leave, and can be dismissed on this device. Hatching gets a short pixel-shell burst and sound cue; level-ups, dungeon milestones, and boss victories use event-driven audio. Scene labels, visible focus, stronger tutorial copy, a subtler CRT overlay, and reduced-motion behavior complete the accessibility pass.

The balance harness simulates 2,000 seeded fresh pets through two dungeon runs using the real game engine. It found a median floor of **18** in the second run; **99.9%** encountered the first boss within two sessions and **65.05%** defeated it. The first run safely banked at floor 9 in **59.7%** of trials; some pets fainted earlier. See the [balance report](docs/phase8-balance.md) for assumptions, floor percentiles, and reach rates.

Use the care buttons or keyboard shortcuts: **1–3** offer the three snacks, **P** plays, **S** toggles sleep, and **C** cleans. On portrait phones, the care buttons stick to the bottom when the care section is in view. Open **Settings** to switch Sound or CRT scanlines, choose button size and opacity, mirror the care controls for a left-handed layout, or enable a short touch haptic. These preferences stay on this device. Buttons act once per press; holding them never repeats a care action. The small hash router uses `#/` for the home screen and `#/about` for the About page, which explains the original-content policy.

## Run locally

Requirements: Node.js 24 or newer and npm.

```sh
npm ci
npm run dev
```

Vite prints a local URL. For a production-like check:

```sh
npm run check
npm test
npm run test:e2e
npm run build
node scripts/simulate-balance.mjs 2000
npm run preview
```

The app is vanilla TypeScript and Canvas 2D. There are no runtime package dependencies. The simulation lives in a Web Worker; IndexedDB stores the versioned save, with localStorage as a fallback. The bundled Press Start 2P font is under the SIL Open Font License; its license is in `LICENSES/`.

## Deploy to GitHub Pages

The workflow in `.github/workflows/deploy.yml` runs type-checks, Vitest, and the production build on pushes to `main`, then deploys `dist` to Pages. In the repository, open **Settings → Pages** and select **GitHub Actions** as the source. The project base path comes from `VITE_BASE_PATH` when set; otherwise it uses `/<repository-name>/` (for this repo, `/dundung/`). The live URL is `https://rom-bar.github.io/dundung/`.

## Data files

Gameplay tuning and form definitions live in JSON under `src/data/` rather than being embedded in the simulation:

- `foods.json` defines the three snacks and their effects. To add a snack, give it a unique `id`, display `name`, `description`, numeric `hunger`, `happiness`, `energy`, and `hygiene` effects, plus descriptive `tags`. The UI creates a snack button from the data automatically.
- `rules.json` defines need bounds and signal thresholds, per-need signal cooldowns, starting needs, awake/sleeping decay, stage timing and level caps, XP rewards, mini-game durations/scoring/cooldowns, tendency signals, action cooldowns/effects, animation timing, worker/save intervals, and toast queue limits.
- `evolutions.json` defines the 20 element/archetype forms, rarity weights and pity, care affinities, elemental and archetype stat multipliers, base stats, and level growth. `traits.json` defines passive, mutation, and drawback effects.
- `dungeon-rules.json`, `rooms.json`, `biomes.json`, `enemies.json`, `skills.json`, and `pet-skills.json` define floor pacing, encounter weights, combat tuning, biome themes, enemies, skills, and drops. `events.json`, `consumables.json`, `tactics.json`, and `loot.json` define event choices, the run pack, combat plans, shops, and treasure-token values.
- `scripts/simulate-balance.mjs` runs deterministic engine-driven trials, prints boss-access and floor-distribution metrics, and exits nonzero if the Phase 8 targets regress.
- `items.json`, `affixes.json`, `sets.json`, and `equipment-rules.json` define gear templates, affix effects, set bonuses, rarity/drop weights, upgrade and fusion rules, capacity and materials. Item behavior is generated from seeded state rather than stored as executable code.
- `home.json` defines the five Home upgrade curves and effects; `achievements.json` defines milestone progress and one-time coin, Essence, and cosmetic rewards.
- `endless-rules.json` defines UTC Daily seeds and attempts, ascension milestones and effects, challenge modifiers, Bestiary coin tiers, and pet-code / ghost-battle safety limits.

Phase 4's wallet and pack are intentionally small and run-focused. Phase 5 adds the separate persistent gear bag, Scrap and Essence; Phase 6 adds Home upgrades and achievements, with no paid services.

## Mini mode support matrix

Mini mode prefers the Document Picture-in-Picture API. If that API is missing or cannot open, Pocket Pal tries video Picture-in-Picture with feed/play media-session actions. During a dungeon run, Document PiP shows the live floor, room, HP, and quick actions; video PiP adds a compact floor/room/HP overlay and remains view-mostly. If neither path is available, the Mini button stays hidden and the normal pause-on-hide behavior remains in effect. API support is feature-detected; this matrix describes the available path, not a promise that every browser build or device exposes it.

| Browser family | Document Picture-in-Picture | Video Picture-in-Picture fallback | Pocket Pal status |
| --- | --- | --- | --- |
| Chromium desktop | Preferred path, when exposed | Fallback, when exposed | Document PiP with interactive care; video fallback is view-mostly |
| Firefox desktop | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |
| Safari desktop and iOS | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |
| Android browsers | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |

## Tests and acceptance checks

`npm run test:unit` covers care, hatch animation state, progression, deterministic evolution weights, Home upgrades, achievements, equipment, save migrations through v6, dungeon settlement, Endless rules, pet-code validation, ghost battles, and sprite overlays. `npm run test:e2e` checks 320×568, 360×740, 390×844, 740×360 landscape, 768×1024 tablet, and 1280×800 desktop for overflow, touch targets, first-steps onboarding, settings, Form Dex, training, Home upgrades, Endless and Bestiary privacy, pet codes, ghost battles, Gear actions, dungeon shops and loot choices, and offline behavior. It stores [visual review screenshots](docs/screenshots/); [`docs/MANUAL_TEST.md`](docs/MANUAL_TEST.md) includes real-device checks emulation cannot prove. The production build also creates a service worker that precaches generated files under the registered repository subpath.

## Original content

Pocket Pal's name, character, pixel scenes, sounds, code, and UI copy were made for this project. It does not use third-party characters, copied game art, sound recordings, or push notifications.
