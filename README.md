# Pocket Pal

A tiny, original virtual pet. Care for Pip in short moments; when you leave, the world pauses. This build includes **Phases 1–4**: the care loop, mini mode, life stages, stats, training, form collection, and the first playable endless dungeon. Equipment and permanent item inventory remain in Phase 5.

**Live site:** <https://rom-bar.github.io/dundung/> (available after GitHub Pages is enabled and the first deployment succeeds).

## Play

Open the live site once while online, then Pocket Pal can load offline from the same browser. Feed Pip one of three snacks, play, tuck Pip in or wake them, clean up, and watch the egg hatch after one active minute. The life cycle continues through Baby, Teen, Adult, and Elder; each stage lasts 15, 45, 120, and 60 active minutes. Elder leaves a new egg with a trait and a small legacy stat bonus. Time never advances while away.

Care nudges Pip's next form without deciding it: the seeded evolution roll weighs play, rest, training, food, hygiene, and elemental food tags. Open **Forms** for the 20-entry Form Dex and past pets. After hatching, **Play a training game** opens Quick Spark (reaction), Echo Garden (memory), or Beat Bubbles (rhythm); results award XP and up to three points, subject to a per-stat training cap of two points per level. A 45-second active-time breather follows each completed game. The five stats and level appear in the growth panel.

On supported browsers, open **Mini** before switching apps to keep Pip's needs moving and use quick care actions in a floating window.

## Dungeon runs (Phase 4)

After Pip hatches, open **Dungeon** and pack up to three run-only consumables for healing, cleansing, or short stat boosts. Each floor offers three different room paths; fights run automatically after choosing a tactic, while events, treasure, rest stops, and shops ask for a small decision. The floor-end screen is a natural stop: descend for more rewards, or leave to bank the run's coins and treasure-token value into Pip's coin balance. If Pip faints, half the run coins and a random half of tokens are kept, the pack is lost, and Pip returns with zero energy. Event boons and curses affect only that run. This phase has no equipment, crafting, or permanent item inventory; those begin in Phase 5.

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
- `dungeon-rules.json`, `rooms.json`, `biomes.json`, `enemies.json`, `skills.json`, and `pet-skills.json` define floor pacing, encounter weights, combat tuning, biome themes, enemies, skills, and drops. `events.json`, `consumables.json`, `tactics.json`, and `loot.json` define event choices, the three-slot run pack, combat plans, shops, and treasure-token values.

Phase 4's wallet and pack are intentionally small and run-focused. Equipment, crafting, and permanent inventory are deferred to Phase 5; home upgrades are Phase 6.

## Mini mode support matrix

Mini mode prefers the Document Picture-in-Picture API. If that API is missing or cannot open, Pocket Pal tries video Picture-in-Picture with feed/play media-session actions. During a dungeon run, Document PiP shows the live floor, room, HP, and quick actions; video PiP adds a compact floor/room/HP overlay and remains view-mostly. If neither path is available, the Mini button stays hidden and the normal pause-on-hide behavior remains in effect. API support is feature-detected; this matrix describes the available path, not a promise that every browser build or device exposes it.

| Browser family | Document Picture-in-Picture | Video Picture-in-Picture fallback | Pocket Pal status |
| --- | --- | --- | --- |
| Chromium desktop | Preferred path, when exposed | Fallback, when exposed | Document PiP with interactive care; video fallback is view-mostly |
| Firefox desktop | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |
| Safari desktop and iOS | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |
| Android browsers | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |

## Tests and acceptance checks

`npm run test:unit` covers clamped simulation steps, active-time decay, care effects and cooldowns, stage transitions, seeded evolution, progression, the dungeon damage/gauge/element/scaling formulas, whole-fight determinism, boss phase two, event modifiers, pack/shop effects, leave/faint banking, save migration, and pointer release. `npm run test:e2e` checks 320×568, 360×740, 390×844, 740×360 landscape, 768×1024 tablet, and 1280×800 desktop for overflow, care sizing/touch, settings, Form Dex, training, dungeon decisions, and offline behavior. It stores [visual review screenshots](docs/screenshots/); [`docs/MANUAL_TEST.md`](docs/MANUAL_TEST.md) includes real-device checks emulation cannot prove. The production build also creates a service worker that precaches generated files under the registered repository subpath.

## Original content

Pocket Pal's name, character, pixel scenes, sounds, code, and UI copy were made for this project. It does not use third-party characters, copied game art, sound recordings, or push notifications.
