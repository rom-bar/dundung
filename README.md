# Pocket Pal

A tiny, original virtual pet. Care for Pip in short moments; when you leave, the world pauses. This build includes **Phase 1: foundation and care loop** and **Phase 2: mini mode**. Dungeon runs, equipment, and generations are later phases.

**Live site:** <https://rom-bar.github.io/dundung/> (available after GitHub Pages is enabled and the first deployment succeeds).

## Play

Open the live site once while online, then Pocket Pal can load offline from the same browser. Feed Pip one of three snacks, play, tuck Pip in or wake them, and clean up. The four needs change only during active play. If the page is hidden, closed, or loses focus, the game pauses and saves; returning never applies time away. On supported browsers, open **Mini** before switching apps to keep Pip's needs moving and use quick care actions in a floating window.

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

All Phase 1 gameplay tuning lives in JSON under `src/data/` rather than being embedded in simulation code:

- `foods.json` defines the three snacks and their effects. To add a snack, give it a unique `id`, display `name`, `description`, numeric `hunger`, `happiness`, `energy`, and `hygiene` effects, plus descriptive `tags`. The UI creates a snack button from the data automatically.
- `rules.json` defines need bounds and signal thresholds, per-need signal cooldowns, starting needs, awake/sleeping decay, stage timing, action cooldowns, action effects, animation timing, worker/save intervals, and toast queue limits.

Quest and item data belong to later dungeon phases and are not part of this build; add their JSON schemas when those features are implemented, not ahead of the phase plan.

## Mini mode support matrix

Mini mode prefers the Document Picture-in-Picture API. If that API is missing or cannot open, Pocket Pal tries video Picture-in-Picture with feed/play media-session actions. If neither path is available, the Mini button stays hidden and the normal pause-on-hide behavior remains in effect. API support is feature-detected; this matrix describes the available path, not a promise that every browser build or device exposes it.

| Browser family | Document Picture-in-Picture | Video Picture-in-Picture fallback | Pocket Pal status |
| --- | --- | --- | --- |
| Chromium desktop | Preferred path, when exposed | Fallback, when exposed | Document PiP with interactive care; video fallback is view-mostly |
| Firefox desktop | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |
| Safari desktop and iOS | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |
| Android browsers | Used when exposed | Fallback, when exposed | Feature-detected; otherwise mini mode is hidden |

## Tests and acceptance checks

`npm run test:unit` covers clamped simulation steps, active-time decay, sleep recovery, action effects and cooldowns, need-signal cooldowns, egg hatching, save migration, seeded RNG repeatability, and multi-pointer release logic. `npm run test:e2e` builds the production app and checks 320×568, 360×740, 390×844, 740×360 landscape, 768×1024 tablet, and 1280×800 desktop for horizontal overflow, care-button sizing, touch activation, settings persistence, left-handed mirroring, and desktop keyboard input. It stores [visual review screenshots](docs/screenshots/); [`docs/MANUAL_TEST.md`](docs/MANUAL_TEST.md) covers thumb comfort, haptic feel, zoom, and offline behavior that emulation cannot prove. The production build also creates a service worker that precaches generated files under the registered repository subpath.

## Original content

Pocket Pal's name, character, pixel scenes, sounds, code, and UI copy were made for this project. It does not use third-party characters, copied game art, sound recordings, or push notifications.
