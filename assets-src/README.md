# Asset sources (research and preserved inputs)

These are unmodified source files collected for the Phaser redesign. The atlas builder selects only documented source pixels and deterministic transforms; it does not draw new sprite geometry.

## Official Kenney packs

- **Tiny Town** — `kenney-tiny-town.zip`; official source page: <https://kenney.nl/assets/tiny-town>; downloaded from the page's official signed download endpoint (`https://kenney.nl/download-link/6173736574732f74696e792d746f776e`); page versions: **1.0 (released 2023), 1.1 (fixed small issue)**; embedded `License.txt` says **Tiny Town (1.1)** and **Creative Commons Zero (CC0)**, usable in personal, educational and commercial projects. Page license: **Creative Commons CC0** (<https://creativecommons.org/publicdomain/zero/1.0/>). SHA-256: `9768692dccff1d706408a5aedd6ca4f6cd1409506cbc84cb2f862919764be977`.
- **Tiny Dungeon** — official source page: <https://kenney.nl/assets/tiny-dungeon>; official Kenney (Assets) download page: <https://kenney-assets.itch.io/tiny-dungeon>; page version: **1.0 (released 2022)**; page/archive license: **Creative Commons CC0** (<https://creativecommons.org/publicdomain/zero/1.0/>), and the page identifies the original archive as `kenney_tinyDungeon.zip`. **Blocker:** the official itch generated-download endpoint returned the HTML download landing page rather than the ZIP payload on repeated attempts in this environment, so no Tiny Dungeon file is retained or represented as downloaded.

Kenney support confirms asset-page packs are public-domain CC0 and usable commercially: <https://kenney.nl/support>. The downloaded Tiny Town archive retains its original `License.txt`; its text was checked directly from the ZIP stream.

## Tiny Creatures

- **Tiny Creatures 1.0** — `tiny-creatures.zip`; source page: <https://opengameart.org/content/tiny-creatures>; author: **Clint Bellanger**; page and bundled license: **CC0 1.0 Universal** (<https://creativecommons.org/publicdomain/zero/1.0/>). The bundled `tiny-creatures/License.txt` says attribution to Clint Bellanger is appreciated but not mandatory, identifies the pack as an expansion of Kenney's Tiny Dungeon/Tiny Town, and says it was made with Kenney's permission. Original archive preserved unchanged. SHA-256: `b397566a1a0f9189dbeb1119a797e35d5985b587596b02f6631d1eacec40252d`.

## Essential additional sources

- **Pixel Food** — `henry-food.png`; Henry Software; CC0 confirmed on the first-party page. Only the first 16x16 cookie tile is used for `food.biscuit`. See [`ADDITIONAL-LICENSES.md`](ADDITIONAL-LICENSES.md) for all URLs, exact crop, and SHA-256.
- **Egg Item Sprite** — `goopybus-egg.png`; GoopyBus; CC0 explicitly stated on the OpenGameArt page. Only the downsampled full egg is used for `pet1.egg`. See [`ADDITIONAL-LICENSES.md`](ADDITIONAL-LICENSES.md) for all URLs, alpha bbox, deterministic transform, and SHA-256.

## SHA-256

- `kenney-tiny-town.zip`: `9768692dccff1d706408a5aedd6ca4f6cd1409506cbc84cb2f862919764be977`
- `tiny-creatures.zip`: `b397566a1a0f9189dbeb1119a797e35d5985b587596b02f6631d1eacec40252d`
- `henry-food.png`: `eb3bd9301354180ec85ebe6558818cffaad53c8bf9677cc3539f9f6d5f5116b4`
- `goopybus-egg.png`: `87321ca5e82ab0b127a5f8a3ce53223d0f091a438547a341a50f246faeb1bec4`
