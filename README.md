# Pocket Pal

A tiny, original virtual pet. Care for Pip in short moments; when you leave, the world pauses. This is **Phase 1: foundation and care loop**. Dungeon runs, equipment, generations, and mini mode are intentionally not included yet.

**Live site:** <https://rom-bar.github.io/dundung/> (available after GitHub Pages is enabled and the first deployment succeeds).

## Play

Open the live site once while online, then Pocket Pal can load offline from the same browser. Feed Pip one of three snacks, play, tuck Pip in or wake them, and clean up. The four needs change only during active play. If the page is hidden, closed, or loses focus, the game pauses and saves; returning never applies time away.

Use the buttons or keyboard shortcuts: **1–3** offer the three snacks, **P** plays, **S** toggles sleep, and **C** cleans. Sound and CRT scanlines can be toggled in the header. The small hash router uses `#/` for the home screen and `#/about` for the About page, which explains the original-content policy.

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

Mini mode is a **Phase 2** feature and is not available in this release. The matrix records implementation status, not a browser compatibility promise; Phase 2 will feature-detect the APIs and then document tested versions.

| Browser family | Document Picture-in-Picture | Video Picture-in-Picture fallback | Pocket Pal status |
| --- | --- | --- | --- |
| Chromium desktop | Planned feature detection | Planned feature detection | Not available in Phase 1 |
| Firefox desktop | Planned feature detection | Planned feature detection | Not available in Phase 1 |
| Safari desktop and iOS | Planned feature detection | Planned feature detection | Not available in Phase 1 |
| Android browsers | Planned feature detection | Planned feature detection | Not available in Phase 1 |

## Tests and acceptance checks

`npm test` covers clamped simulation steps, active-time decay, sleep recovery, action effects and cooldowns, need-signal cooldowns, egg hatching, save migration, and seeded RNG repeatability. The production build also creates a service worker that precaches the generated files under the registered repository subpath. Manual checks: open on a 360 px phone layout, install from a supported browser prompt, go offline after the first visit, close and reopen to verify the saved pet is paused.

## Original content

Pocket Pal's name, character, pixel scenes, sounds, code, and UI copy were made for this project. It does not use third-party characters, copied game art, sound recordings, or push notifications.
