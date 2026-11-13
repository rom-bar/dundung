# Stage art and asset credits

Pocket Pal's live stage uses two deliberate pixel-art layers. The pet and Coal Cub use original 48×48 character sprites authored for this project; the environment, tiles, props, food and egg use verified CC0 sources. The original character sheets are not traced from, copied from, or upscaled from third-party character art. All source locations, transformations and generated-file hashes are recorded below and in the manifests.

## Original live character art

- **Rabbit character sheets** — Original 48×48 RGBA pixel art authored for Pocket Pal by the project contributors. The five elemental palettes (fire, water, moss, storm and shadow) each have four hand-authored poses: `idle`, `walk-a`, `walk-b`, and `hurt`.
- **Coal Cub character sheet** — Original 48×48 RGBA pixel art authored for Pocket Pal by the project contributors, with four hand-authored poses: `idle`, `hop-a`, `hop-b`, and `hurt`.
- **License and provenance** — Both character assets are dedicated to the public domain under **CC0 1.0 Universal**. The pixel geometry is authored in `scripts/build-pocket-pal-original-art.py`; `assets-src/pocket-pal-original/README.md` and `manifest.json` record the license, identity, frame size and render contract. No third-party character pixels are copied or enlarged.
- **Reproducible sheets** — `scripts/build-pocket-pal-character-sheets.py` packs the reviewed source frames into `public/assets/stage/characters/`. `public/assets/stage/characters/manifest.json` records frame order, source hashes and sheet hashes.
- **Pixel scale** — Character frames render at object scale 1 with the stage's integer 2× camera, so one source pixel maps to two canvas pixels. Movement, feet and shadows are aligned to the same output-pixel grid.

## Environment, props and legacy atlas sources

- **Tiny Creatures 1.0** — Clint Bellanger, CC0 1.0 Universal. Source: https://clintbellanger.net/ and the bundled `tiny-creatures/License.txt`; license: http://creativecommons.org/publicdomain/zero/1.0/ . The 16×16 atlas retains the verified rabbit tile (index 152) and slime tile (index 99) as compatibility/fallback frames; the live character renderer uses the original 48×48 sheets above.
- **Tiny Dungeon (base pack)** — Kenney, CC0 1.0 Universal. Source: https://kenney.nl/assets/tiny-dungeon; license evidence is bundled in `tiny-creatures/License.txt` and `kenney-tiny-town/License.txt`. License reference: http://creativecommons.org/publicdomain/zero/1.0/ .
- **Tiny Town 1.1** — Kenney, CC0 1.0 Universal. Source: https://kenney.nl/assets/tiny-town; license: `kenney-tiny-town/License.txt`. Attribution is appreciated but not required.
- **Pixel Food** — Henry Software, CC0 1.0 Universal. First-party source page: https://henrysoftware.itch.io/pixel-food; downloaded source page: https://opengameart.org/sites/default/files/Food_0.png. License evidence and SHA-256: `assets-src/ADDITIONAL-LICENSES.md`. Only the original 128×128 sheet's first 16×16 cookie tile is used as `food.biscuit`.
- **Egg Item Sprite** — GoopyBus, CC0 explicitly stated on the source page. Source page: https://opengameart.org/content/egg-item-sprite; source file: https://opengameart.org/sites/default/files/egg_0.png; license evidence and SHA-256: `assets-src/ADDITIONAL-LICENSES.md`. The complete 32×32 RGBA image is downsampled to 16×16 with nearest-neighbor resampling for `pet1.egg`, preserving alpha.

## Verified semantic choices and transforms

- The old atlas rabbit frame is Tiny Creatures RGBA `Tilemap/tilemap.png`, index `152`; the individual P-mode tile has no transparency metadata and is not used for alpha. The prior mixed-species indices `0131`, `0132`, `0151`, `0165`, and related tiles are not used.
- The old atlas slime frame is Tiny Creatures RGBA master `Tilemap/tilemap.png`, index `99`. The live enemy actor uses the original Coal Cub sheets instead.
- Food is the Henry Software Pixel Food crop `(0,0,16,16)`, the first cookie tile with chocolate chips. The biscuit is a separate overlay asset, not a pet frame.
- The egg uses the entire GoopyBus source `(0,0,32,32)` downsampled to `(16,16)` with `Image.Resampling.NEAREST`, preserving the source alpha bounding box `(6,5,26,30)`. It is a pre-hatch item frame.
- Chests use Tiny Dungeon tiles `089` (closed) and `090` (open). Door and shield icons from Tiny Town are not named as chests.
- Dungeon utilities use Tiny Dungeon tiles `048` (floor), `050` (path), `014` (brick wall), and `125` (torch).
- The exact source member, sheet index, frame ID and deterministic transform for the 16×16 environment/legacy atlas are recorded in `public/assets/stage/asset-manifest.json`. Rebuild it with `python3 scripts/build-stage-atlas.py`.

## Renderer contract

The live Phaser renderer loads `public/assets/stage/characters/*.png` as character sheets and uses the 16×16 stage atlas for verified environment tiles, props, food/egg and legacy fallback frames. Character and environment movement share integer output-pixel alignment; Canvas rendering does not depend on WebGL tint fills. The atlas builder bakes required color variants, white hit-flash and small particle masks reproducibly. Legacy atlas animation definitions remain in `src/data/stage-sprites.json`; custom character-sheet poses and their frame order are recorded in `public/assets/stage/characters/manifest.json`.
