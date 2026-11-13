# Pocket Pal: Game Design Document (phased)

Working title: **Pocket Pal** (generic name; never use trademarked names such as "Tamagotchi").
Genre: single-pet virtual pet + roguelite dungeon, endless, offline PWA on GitHub Pages.

> How to use this doc: build **one phase at a time**. Each phase has scope, deliverables, data files, and acceptance criteria. Do not start phase N+1 until phase N is playable, tested, committed, and deployed. All balance numbers live in data files (JSON), never hardcoded.

---

## 0. Principles and global decisions

### 0.1 Product pillars
1. **One pet, one save.** Focus on a single character.
2. **Play-time only.** The game advances only while actively played. No background simulation, no catch-up for time away, no punishment for absence.
3. **Three interlocking loops** so it can be endless but fun:
   - Short loop (30 s to 2 min): care (feed, play, train, clean).
   - Mid loop (5 to 10 min): dungeon run.
   - Long loop (hours): generations (aging, egg, legacy, collection, meta-upgrades).
4. **Care feeds the dungeon; the dungeon feeds care.** Food gives run buffs, training raises stat caps, loot funds home upgrades.
5. **Always a stop point.** Every floor, quest, or level-up is a natural place to quit satisfied.
6. **Original everything.** Art, sounds, names, code. No copied or trademarked material. Include an About page saying so.

### 0.2 Platform and stack
- Vite + TypeScript, vanilla (no UI framework). Canvas 2D for scenes, DOM/CSS for menus and HUD.
- Vitest for unit tests. Zero runtime dependencies where possible.
- Static build hosted on **GitHub Pages** via GitHub Actions. Hash router. `base` from env (default `/<repo-name>/`).
- **PWA**: manifest + service worker, fully offline. Correct scope for the subpath.
- Persistence: IndexedDB (fallback localStorage). Versioned save schema with migrations.
- Web Worker runs the simulation; the main thread renders.
- Seeded RNG (e.g. mulberry32) for all gameplay randomness, so logic is testable and daily seeds work.

### 0.3 Visual and audio style: retro look, modern polish
- Pixel font (self-hosted, e.g. Press Start 2P), crisp pixel scaling (`image-rendering: pixelated`), limited neon palette on dark background.
- Optional CRT/scanline effect with a toggle. Respect `prefers-reduced-motion`.
- Pixel art generated in code (sprite arrays or canvas drawing). Equipment and element/archetype shown visually on the sprite.
- Chiptune SFX via Web Audio API (no audio files). Mute toggle.
- Mobile-first, touch-friendly large buttons, works at 360 px width and desktop. No accidental zoom or scroll during play.

### 0.4 Time model (critical)
- Fixed-timestep loop with clamped `dt` (max 100 ms).
- Game is **active** when the page is visible OR mini mode (PiP) is open. Otherwise **paused**.
- On `visibilitychange(hidden)`, `pagehide`, `blur`: pause (unless mini mode open) and save immediately.
- Autosave every ~10 s (iOS may not fire `pagehide`).
- On return: overlay "Paused, tap to continue". Never compute time away.
- Simulation runs in a Web Worker so it is not throttled when the tab is hidden but mini mode is open. Pure, deterministic, unit-testable core.

### 0.5 In-app notifications only
- No push, no OS notifications.
- Toast queue + pet signals (speech bubble, bounce, face change, beep, optional vibration).
- Per-need cooldowns to prevent spam. Dot/badge on relevant action buttons.
- Same notifications render inside the mini window.

### 0.6 Mini mode (floating window above other apps)
- "Mini mode" button (needs a user gesture), with feature detection.
- **Primary:** Document Picture-in-Picture API (`documentPictureInPicture.requestWindow`). Compact interactive UI: pet canvas, need bars, quest/dungeon progress, quick actions, toasts. Copy styles into the PiP document. Render with the PiP window's own `requestAnimationFrame`.
- **Fallback 1:** video PiP (canvas `captureStream()` into a hidden `<video>`, `requestPictureInPicture()`), with Media Session actions (Feed, Play). View-mostly.
- **Fallback 2:** hide the button; rely on pause-on-hide.
- Closing the PiP window returns to normal pause rules. Document the browser support matrix in the README.

### 0.6 Architecture
```
src/core/        worker sim: state machine, needs, evolution, dungeon, combat, loot (pure functions)
src/render/      canvas renderer, sprites, HUD, toasts, PiP renderer
src/platform/    visibility/pause manager, PiP manager, storage, audio, input, RNG
src/data/        foods.json, evolutions.json, traits.json, enemies.json, rooms.json,
                 affixes.json, items.json, sets.json, home.json, events.json
tests/           vitest unit tests for core
```
- Worker messages: `tick`, `input`, `snapshot`, `save`.
- Save schema has `version`; `migrate(save)` function with tests.

### 0.7 Deployment (set up in Phase 1, keep working throughout)
- `.github/workflows/deploy.yml`: on push to `main`: setup-node, `npm ci`, `npm test`, `npm run build`, `upload-pages-artifact` (`dist`), `deploy-pages`. Permissions `pages: write`, `id-token: write`; concurrency group.
- README: live URL, enable Pages (Settings, Pages, Source: GitHub Actions), how to add data (foods, quests, items), mini mode support matrix.

### 0.8 Quality bar (every phase)
- Zero TypeScript errors; tests pass; build passes before each commit.
- Lighthouse PWA/performance/accessibility >= 90.
- Commit after each deliverable; push; confirm the live site works.

---

## Phase 1: Foundation and care loop (playable pet)

**Goal:** a cute, living pet you can care for, offline, deployed.

### Scope
- Project scaffold, deploy workflow, PWA shell, retro theme, About page.
- Engine: fixed-timestep loop, worker sim, input manager, audio manager, storage, RNG, pause manager, autosave.
- One placeholder pet form (egg, baby) with animations: idle, eat, play, sleep, sad, sick.
- Needs: hunger, happiness, energy, hygiene (0 to 100).
- Actions: feed (3 foods), play, sleep/wake, clean.
- Toasts and pet signals (section 0.5).

### Mechanics
- Decay per **active minute** (tune for 5 to 15 min sessions; a decision or event every 20 to 40 s):
  - hunger -3, happiness -2, energy -2 (awake), hygiene -1.5
  - Sleeping: energy +8/min, hunger -1.5/min, other needs paused.
- Need thresholds: < 30 shows a signal; 0 causes "unhappy" state and stat penalty (used later).
- Foods (data-driven `foods.json`): `{ id, name, hunger, happiness, energy, hygiene, element?, tags }`.
- Cooldowns on actions (e.g. 2 s) to prevent mashing.
- Life stage clock (active minutes): Egg 1, Baby 15, Teen 45, Adult 120, Elder 60. (Only Egg and Baby active in this phase; the rest are placeholders.)

### Deliverables
- Live URL on github.io, installable PWA, works offline.
- Pause/resume works (no catch-up), autosave works.

### Acceptance criteria / tests
- Decay with `dt` clamping; no catch-up after pause; save/load roundtrip; migration stub.
- Manual: close tab, reopen, state identical and paused.

---

## Phase 2: Mini mode (floating window)

**Goal:** keep playing while using other apps.

### Scope
- Mini mode button, Document PiP renderer, video PiP fallback, feature detection.
- Pause rule update: active = visible OR mini window open.
- Move sim fully into the worker if not already; render in PiP's own rAF.
- Toasts and quick actions inside the mini window.

### Acceptance criteria
- With the main tab hidden and PiP open, needs keep decaying; closing PiP pauses.
- Fallbacks degrade cleanly; README support matrix written.

---

## Phase 3: Stats, levels, stages and random evolution

**Goal:** the pet grows into a random, unique form shaped (but not decided) by care.

### Stats and growth
- Stats: **HP, ATK, DEF, SPD, LUK**.
- `stat = floor((base + growth x level + train) x archetypeMult x (1 + gear%) + gearFlat)`
- XP to next level: `20 x 1.18^(level-1)`. XP sources: care actions (small), mini-games, dungeon (later).
- Training cap per stat: `2 x level`.
- Mini-games (about 20 s each): reaction tap, memory match, rhythm. Score maps to training points (0 to 3 per play, with a short cooldown).
- Level caps per stage: Baby 5, Teen 15, Adult 40, Elder 40 (stats decline 1%/active min in Elder).

### Care tendencies
- Track per stage, each 0 to 1, as an exponential moving average: `play, sleep, fight, feedQuality, hygiene`.
- `tendency = tendency x 0.98 + signal x 0.02` per relevant action (signals defined in data).

### Evolution rules (random, biased by care)
- Form = **Element** x **Archetype** (+ optional **Mutation**).
- Elements: Fire, Water, Moss, Storm, Shadow. Chosen from foods eaten (element tags) and, later, the last dungeon biome.
- Archetypes: Tank, Striker, Trickster, Healer. Affinities (data-driven):
  - Tank <- sleep + feedQuality
  - Striker <- fight + training
  - Trickster <- play
  - Healer <- hygiene + sleep
- Form weight: `w = baseWeight x (1 + sum(tendency x affinity))`, then a weighted random roll with the seeded RNG.
- Base weights: common 10, uncommon 4, rare 1.
- **Pity:** each roll without a rare adds `+0.5 x misses` to rare weights; reset on a rare.
- **Mutation:** 3% per evolution (+1% per pity miss, cap 10%). Grants one strong trait; 50% chance of a drawback.
- **Traits:** each form gets 2 passive traits from `traits.json` (e.g. "Glutton: food heals +50%", "Night Owl: sleeping restores +25% energy").
- **Evolution Stone** (rare item, reroll once). Introduced as a debug/unlockable item here; obtainable from bosses in Phase 5.
- **Form Dex:** collection screen listing discovered forms and silhouettes of undiscovered ones.

### Life cycle and legacy
- Egg -> Baby -> Teen -> Adult -> Elder -> leaves an egg.
- New egg inherits 1 parent trait and +5% base stats. **Hall of Pets** stores previous pets (name, form, peak level, deepest floor later).

### Deliverables
- Evolution animations/sprites for at least 5 elements x 4 archetypes using procedural palette/shape variation.
- Dex, trait system, tendencies HUD (small).

### Tests
- Weighted roll distribution with seeded RNG; pity counter; mutation chance cap; stat formula; training caps; stage transitions.

---

## Phase 4: Dungeon core

**Goal:** the endless descent, auto-combat with tactical decisions.

### Structure
- A run = descending floors. Floor = **3 rooms**; before each room choose among **3 options**.
- Room weights (`rooms.json`): Fight 45, Event 20, Treasure 10, Rest 10, Shop 10, Elite 5 (Elite from floor 5).
- **Boss every 10th floor** (single boss room). **Biome changes every 10 floors** (5 biomes, loop with scaling).
- Pacing: room 15 to 30 s, floor about 60 s, typical run 5 to 10 floors.

### Combat (auto)
- Action gauge: `gauge += SPD x dt`; acts at 100, then resets.
- `damage = max(1, ATK x skillMult x 100/(100+DEF) x elem x crit x rand(0.9, 1.1))`
- `critChance = min(50%, 5% + 0.4% x LUK)`, `critMult = 1.5 + gear`
- Elements: Fire > Moss > Water > Fire (x1.25 / x0.8); Storm <-> Shadow (x1.25 each way); otherwise x1.
- **Tactic card** chosen before each fight (data-driven): Guard (-25% damage taken, -10% ATK), All-in (+30% ATK, +20% damage taken), Focus (+15% crit chance), Swift (+20% SPD, -10% DEF).
- Consumables usable between and during fights (heal, cleanse, buff).
- Pet skill: each form has one basic skill with multiplier and optional effect (stun, burn, shield), data-driven.

### Enemies
- `enemies.json` per biome: base stats, element, skill, loot table.
- Scaling: `stat = base x 1.09^floor`; elite x1.6 HP, x1.2 ATK; boss x2.5 HP, x1.3 ATK with a phase-2 ability.

### Resources and care inside the dungeon
- Per room: hunger -1; per fight: energy -2.
- Below 30%: -15% ATK/SPD. At 0: -40% ATK/SPD and no HP regen.
- Rest room: heal 30% max HP and may restore some energy.
- Pet packs up to 3 foods/consumables at run start.
- **Phase 4 economy default:** keep the economy deliberately run-sized: a small coin wallet for the current dive and a three-slot, data-driven pack of heal/cleanse/buff consumables. Shop and treasure rooms use that coin loop; leaving banks coins and token value, while fainting applies the penalty below. Do not add equipment, a permanent item inventory, crafting, or home upgrades in this phase; equipment/inventory starts in Phase 5 and home upgrades in Phase 6.

### Run end and push-your-luck
- After each floor: **Descend** or **Leave** (bank everything).
- Faint (0 HP): keep 50% coins and a random half of the loot; lose consumables. Pet returns exhausted (energy 0), which forces care time before the next run.
- Boons and curses appear at event rooms (e.g. "+15% crit this run" / "-10% max HP but +25% coins"). Stored in run state only.
- Depth record per pet and global.

### Events
- `events.json`: short choice events with 2 to 3 options and probabilistic outcomes (risk/reward). Seeded RNG.

### Deliverables
- Dungeon screen with node map, combat visualization (compact log + animated bars), tactic selection, run summary screen.
- Mini mode shows run progress (floor, HP bar, current room).

### Tests
- Gauge/damage formulas, elemental multipliers, scaling curves, run end rules (leave vs faint), seeded determinism of whole runs.

---

## Phase 5: Loot and equipment

**Goal:** a reason to keep diving.

### Items
- Slots: **Weapon, Armor, Hat, Charm**. Visible on the sprite.
- `itemStat = slotBase x (1 + 0.06 x ilvl) x rarityMult x rand(0.8, 1.2)`, with `ilvl = floor + rand(0, 2)`.
- Rarity weights (%): Common 60, Uncommon 25, Rare 10, Epic 4, Legendary 1. Rare and above weights x `(1 + LUK/200)`.
- Rarity multiplier: 1, 1.2, 1.5, 1.9, 2.5. Affix count: 0, 1, 2, 3, 4. Legendaries also have a unique effect.
- Elites guarantee at least Uncommon; bosses at least Rare.
- Affixes (`affixes.json`): flat/percent stats, crit, lifesteal, element damage, food effectiveness, coin find, resist, thorns, on-hit status. Value = `baseAffix x rarityMult x ilvlScale x rand(0.8, 1.2)`.

### Sets
- Element-themed sets (`sets.json`) with 2-piece and 4-piece bonuses, synergizing with traits and element forms.

### Inventory and crafting
- Limited inventory (e.g. 20). **Scrap** to convert unwanted items into materials; auto-scrap option by rarity.
- **Upgrades** to +10: cost `10 x 1.5^n` scrap, +8% per level; failure above +5 drops one level (never destroys).
- **Fusion:** 3 same-slot, same-rarity items -> one of next rarity, keeping one chosen affix.
- Compare-with-equipped UI (before/after stats).

### Currencies
- **Coins** (shop, home), **Scrap** (upgrades), **Essence** (Evolution Stones, from bosses).

### Phase 5 implementation defaults
- Preserve Phase 4's intentionally small run-only shop wallet and three-slot consumable pack. Gear shop purchases use run coins and enter a separate run bag; they do not become permanent until the run ends safely.
- Keep the permanent gear bag at 20 items and cap carried gear at 20 per run. When the permanent bag is full, salvage only an incoming drop or overflowed kept item into Scrap; never delete an existing item. Auto-scrap applies only to new drops, not gear the player explicitly buys.
- A safe return banks all carried items and materials. On faint, keep a seeded random half of carried gear and half of carried materials, matching the existing half-coin/half-token economy. Equipment changes are locked during an active run.
- Craft one Evolution Stone for 30 Essence. This preserves the existing reroll mechanic while making boss Essence useful. These values are data-driven in `equipment-rules.json`.

### Deliverables
- Loot drops in dungeon, inventory/equipment screens, shop room, workshop (upgrade/fuse/scrap).

### Tests
- Rarity distribution with LUK, affix roll ranges, upgrade cost/success, fusion rules, set bonus calculation, inventory limits.

---

## Phase 6: Meta-progression and home

**Goal:** every run matters, even failed ones.

### Home upgrades (`home.json`)
- Five upgrades, each capped at level 5. Cost is `floor(50 x 1.6^currentLevel)` coins; all balance values live in `home.json`.
  - **Kitchen:** food effects +5% per level (max +25%); pack grows from 3 to 4 at level 2 and 5 at level 4. A free prepared meal boosts one selected stat by +10% at level 0, then +2 percentage points per Kitchen level, up to +20%. It is consumed only after a valid run starts.
  - **Gym:** raises the `2 x pet level` training cap by 15% per level and increases mini-game training rewards by 10% per level.
  - **Workshop:** reduces equipment upgrade Scrap costs by 8% per level and fusion Scrap costs by 10% per level (each discount bottoms out at 50%); adds 5 permanent inventory spaces per level. The baseline fusion fee is 30 Scrap.
  - **Nursery:** adds +1 percentage point to each generation's legacy stat bonus per level (up to 25%); level 3 passes down one additional distinct trait.
  - **Library:** adds +0.05% to stats per discovered form per Library level. Level 1 reveals a general evolution clue; level 3 reveals the top three current form-weight shares, without naming undiscovered forms.
- **Goals and achievements:** six one-time milestones cover five/all Form Dex entries, floor 5, a first boss in a new biome, an equipped two-piece set, and clearing the floor-10 boss. Rewards are data-driven coins, Essence, and cosmetic keepsakes.
- **Records:** lifetime rooms cleared, bosses defeated, safe returns, faints, best floor in one run, total coins banked, plus current/global depth, forms, generation, equipped sets, and unlocked keepsakes.
- **Persistence:** schema v5 adds Home levels, a prepared meal, achievements/cosmetics, boss-first flags, and lifetime records; older saves migrate with bounded defaults.

### Deliverables
- Home screen with upgrade tree, achievements screen, stats/records page.

### Tests
- Upgrade cost scaling, Kitchen pack/meal rules, Gym caps, Workshop discounts/capacity, Nursery inheritance, Library weight hints, one-time reward/idempotency, v4-to-v5 migration, and dungeon record settlement.

### Implementation defaults
- Home upgrades use banked coins and cannot be changed during a dungeon run. A meal is free and only one may be prepared at a time; failed run validation does not consume it.
- Achievements award their listed rewards automatically once, when an accepted game transition reaches the goal. Cosmetics are keepsakes in the Home screen and do not alter balance.
- Evolution weight hints use the same seeded weight formula as the next evolution roll; they are informational and never change the roll.

---

## Phase 7: Endless-play systems

**Goal:** long-term retention without grind.

- **Daily seeded dungeon** (date-based seed, works offline, one attempt per day with leaderboard-less personal best).
- **Ascension (prestige):** after reaching a milestone depth, increase the challenge and choose a permanent perk; reset only progress toward the next ascension, not lifetime records or gear.
- **Difficulty modifiers** (opt-in): stackable run modifiers for bonus rewards.
- **Pet codes:** export/import a compressed string of a pet for friendly **ghost battles** (no server). Validate and sanitize imported codes.
- **Bestiary:** enemy knowledge unlocks small bonuses.

### Tests
- Seed determinism (same date, same dungeon), code encode/decode roundtrip and validation, ascension reset rules, modifier effects, and Bestiary discovery privacy.

### Implementation defaults
- Daily trials use the UTC date key, a deterministic seeded run, and one attempt per date. The personal best is stored locally; there is no online leaderboard. Daily runs ignore opt-in difficulty modifiers.
- Ascension starts at floor 20, then requires five additional floors per rank, up to rank 5. Each rank raises enemy stats by 6%, coins by 4%, loot chance by 3%, and rarity luck by 4; it grants one stack of a chosen permanent perk. The milestone, cap, and effects are in `endless-rules.json`.
- Standard runs can stack up to three of four opt-in difficulty modifiers. Their enemy and reward multipliers are data-driven in `endless-rules.json`.
- Pet codes use a versioned `PP1` format, gzip when browser streams are available, and URL-safe Base64. Decode validates the version, form, traits, stats, and bounded input size before use. Ghost battles are deterministic, local, capped at 24 turns, and never award run or account rewards.
- The Bestiary reveals only encountered enemy names. Unique-enemy milestones at 5, 10, 15, and 20 give small permanent coin bonuses. Save schema v6 adds this progress and migrates older saves with bounded defaults.

---

## Phase 8: Polish and release

- Sound design pass, animation polish, CRT toggle refinement, accessibility (labels, focus, contrast, reduced motion).
- Onboarding tutorial (first egg, first run).
- Balance pass: simulate thousands of seeded runs with a script to tune the curve (target: fresh pet hits a soft wall around floor 15 to 20; first boss reachable in about 2 sessions).
- Final README, About/credits, Lighthouse checks, offline verification, save migration review.

---

## Balance targets and tuning knobs

| Knob | Starting value | Notes |
|---|---|---|
| Need decay per active minute | hunger 3, happiness 2, energy 2, hygiene 1.5 | Tune for 5-15 min sessions |
| Stage durations (active min) | 1 / 15 / 45 / 120 / 60 | About 4 h per generation |
| XP curve | 20 x 1.18^(L-1) | Adjust growth factor |
| Enemy scaling | 1.09^floor | Core difficulty slope |
| Gear scaling | 0.06 per ilvl | Must outpace or match enemy slope early |
| Rarity weights | 60/25/10/4/1 | LUK shifts upward |
| Rest heal | 30% max HP | Controls run length |
| Faint penalty | 50% coins, half loot | Tension vs frustration |
| Home upgrade cost | 50 x 1.6^level | Sink for coins |

## Phase dependency summary

1. Foundation + care -> 2. Mini mode -> 3. Stats + evolution -> 4. Dungeon -> 5. Equipment -> 6. Meta/home -> 7. Endless systems -> 8. Polish.

Phases 1 to 3 give a complete, shippable pet game. Phases 4 to 5 turn it into a roguelite. Phases 6 to 8 give long-term depth.

## Working rules for the agent
- Ship each phase fully (code, tests, deploy) before starting the next; commit after each deliverable.
- Keep balance in JSON data files; keep core logic pure and tested.
- If blocked, decide sensibly and record the decision in the README; ask only when truly stuck.
- At the end of each phase, report: live URL, what's done, what's deferred.
