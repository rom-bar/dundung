# Stage art credits

The stage atlas preserves original 16px alpha silhouettes from the source archives in `assets-src/`, with documented flips, palette swaps and alpha-preserving solid recolors. No new sprite geometry is drawn in code. Pet and slime animation states intentionally reuse one verified base sprite; orientation flips, renderer scale/rotation, and the biscuit overlay are procedural presentation, not alternate hand-drawn source-pose claims. Canvas rendering does not support Phaser WebGL tint fills, so white hit-flash, five element palettes, and tiny colored particle masks are baked into the atlas reproducibly. The egg is shown as a pre-hatch item frame; it is not visually hatched by the atlas.

- **Tiny Creatures 1.0** — Clint Bellanger, CC0 1.0 Universal. Source: https://clintbellanger.net/ and the bundled `tiny-creatures/License.txt`; license: http://creativecommons.org/publicdomain/zero/1.0/
- **Tiny Dungeon (base pack)** — Kenney, CC0 1.0 Universal. Source: https://kenney.nl/assets/tiny-dungeon; license: `tiny-creatures/License.txt` and the bundled `kenney-tiny-town/License.txt`. License reference: http://creativecommons.org/publicdomain/zero/1.0/
- **Tiny Town 1.1** — Kenney, CC0 1.0 Universal. Source: https://kenney.nl/assets/tiny-town; license: `kenney-tiny-town/License.txt`. Attribution is appreciated but not required.
- **Pixel Food** — Henry Software, CC0 1.0 Universal. Source page: https://henrysoftware.itch.io/pixel-food; downloaded source page: https://opengameart.org/sites/default/files/Food_0.png; license evidence and SHA-256: `assets-src/ADDITIONAL-LICENSES.md`. Only the original 128x128 sheet's first 16x16 cookie tile is used as `food.biscuit`.
- **Egg Item Sprite** — GoopyBus, CC0 explicitly stated on the source page. Source page: https://opengameart.org/content/egg-item-sprite; source file: https://opengameart.org/sites/default/files/egg_0.png; license evidence and SHA-256: `assets-src/ADDITIONAL-LICENSES.md`. The whole 32x32 RGBA source is downsampled to 16x16 with nearest-neighbor resampling for `pet1.egg`.

The exact source member, optional sheet index, frame ID, and deterministic transform are recorded in `public/assets/stage/asset-manifest.json`. The atlas is rebuilt with `python3 scripts/build-stage-atlas.py`.

## Verified semantic choices

- Pet base: Tiny Creatures RGBA `Tilemap/tilemap.png`, index `152`, a white rabbit. The individual P-mode tile has no transparency metadata and is deliberately not used for alpha. The prior `0131`, `0132`, `0151`, `0165`, and related mixed species are not used. All `pet1.rabbit.*` states reuse this one body; flips are orientation only.
- Slime base: Tiny Creatures RGBA master `Tilemap/tilemap.png`, index `99`, reused for idle/attack/hurt/death; only horizontal orientation and the documented tint variant differ.
- Food: Henry Software Pixel Food `henry-food.png`, crop `(0,0,16,16)`, the first cookie tile with chocolate chips. `pet1.eat` contains pet frames only; the biscuit is a separate overlay asset and can never become the actor frame.
- Egg: GoopyBus `goopybus-egg.png`, full source `(0,0,32,32)` downsampled to `(16,16)` with `Image.Resampling.NEAREST`, preserving RGBA alpha (source alpha bbox `(6,5,26,30)`). It is a pre-hatch item frame.
- Chest: Tiny Dungeon sheet `Kenney_tiny_dungeon.png`, tile `089` closed and tile `090` open. Door/shield icons from Tiny Town are not named as chests.
- Dungeon utilities: Tiny Dungeon sheet tiles `048` floor, `050` path, `014` brick wall, and `125` torch.

## Renderer contract

Load `stage/atlas.png` with `stage/atlas.json` as a Phaser atlas. Named animation definitions and frame IDs are in `src/data/stage-sprites.json`. Use `layers[]` for parallax biome/dungeon layers; integer-scale the 16px actors/props so the pet reads at no less than 25% of the stage height. Apply pet/slime expression or motion through renderer scale/rotation and overlays while keeping the verified base sprite identifiable.

Animation names available: `pet1.idle`, `pet1.walk`, `pet1.attack`, `pet1.hurt`, `pet1.eat`, `pet1.sleep`, `pet1.happy`, `pet1.faint`, `enemy1.idle`, `enemy1.attack`, `enemy1.hurt`, `enemy1.death`, `enemy1.variant-idle`, `chest.open`, and `particle.sparkle`.
