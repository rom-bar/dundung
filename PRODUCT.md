# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Children are the primary audience. The exact age range, reading level, and role of parents or guardians are not yet specified. Players care for Pip in short sessions and make simple choices during dungeon runs.

## Product Purpose

Pocket Pal is an original virtual-pet game. Players care for Pip, watch Pip grow, and take Pip into deterministic dungeon runs. Success means the pet's needs and actions are understandable, care feels rewarding, and run decisions are clear without requiring long sessions. Active time pauses when the player leaves the app.

## Positioning

Pocket Pal combines a short, local-first pet-care loop with seeded dungeon progression. A Web Worker is authoritative for gameplay; stage presentation observes its state and events but never changes outcomes.

## Operating Context

The game runs as a browser-based PWA on phones and desktop. After the first online load, its service worker supports offline play. Saves use IndexedDB with localStorage fallback. The main activity is a brief visit to care for Pip or make a dungeon decision; the game does not advance while the player is away.

## Capabilities and Constraints

- The existing game includes pet care, growth, training, equipment, home upgrades, dungeons, events, loot, and local records.
- Gameplay remains deterministic and worker-owned. Visual events are derived from state transitions and must not consume gameplay RNG or modify simulation state.
- Phaser 3 is for the stage only; menus, status, actions, and the details sheet stay in the DOM. The engine is dynamically loaded, and its built assets must remain available offline.
- Preserve the stage-first fixed-height layout, mobile and landscape reachability, reduced-motion behavior, the event log, and a 60 fps target on a mid-range phone.
- Keep UI language within the project's established English/Indonesian context. Copy and imagery must be suitable for children; avoid mature language, sexual content, and graphic violence. The exact age rating is undecided.
- Use only CC0 or otherwise clearly licensed assets whose terms permit redistribution. Do not reuse artwork from the supplied game screenshots or other games.
- The project has no paid services or online leaderboard.

## Brand Commitments

The product is Pocket Pal and its pet is Pip. The project is original. User-supplied game screenshots are high-level visual/layout references only, not source art or permission to copy their characters, sprites, or distinctive compositions.

## Evidence on Hand

The repository contains a runnable web app, its README, an original app icon, and the current source implementation. No testimonials, customer evidence, or approved commercial claims are present.

## Product Principles

1. Gameplay state, not animation, decides outcomes.
2. Care and dungeon choices should be easy to understand in short visits.
3. Play should work locally and offline after the initial load.
4. Every visible asset must be original or have documented redistribution rights.
5. Language and imagery should be age-appropriate without assuming an exact age range.

## Accessibility & Inclusion

Respect `prefers-reduced-motion`; keep essential state available in DOM text and the Log tab rather than only through animation. Preserve keyboard and touch access. Keep the established English/Indonesian language context; reading-level requirements beyond child-appropriate wording remain undecided.
