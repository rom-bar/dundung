# Additional source licensing evidence

These notes document the two additional source files used only for the missing essential biscuit and egg frames. The original downloaded PNGs are preserved unchanged; no license file was supplied by either source, so this is human-readable evidence rather than an embedded original license file.

## Pixel Food / Henry Software

- Author: Henry Software
- License: Creative Commons Zero v1.0 Universal (CC0), confirmed on the first-party page's “More information” section; author comments allow commercial use.
- First-party page: https://henrysoftware.itch.io/pixel-food
- Downloaded source file: `henry-food.png`
- Secondary download URL: https://opengameart.org/sites/default/files/Food_0.png
- Secondary page: https://opengameart.org/content/64-16x16-food-sprites
- Original dimensions: 128x128 RGBA, an 8x8 grid of 16x16 tiles.
- SHA-256: `eb3bd9301354180ec85ebe6558818cffaad53c8bf9677cc3539f9f6d5f5116b4`
- Project use: only crop `(0,0,16,16)`, the first tile, for `food.biscuit`. The tile is the source cookie with chocolate chips; no other food tiles are included in the atlas.

## Egg Item Sprite / GoopyBus

- Author: GoopyBus
- License: CC0, explicitly stated by the author on the OpenGameArt source page.
- Source page: https://opengameart.org/content/egg-item-sprite
- Source file: https://opengameart.org/sites/default/files/egg_0.png
- Original dimensions: 32x32 RGBA.
- Original alpha bounding box: `(6,5,26,30)`; transparent corners are preserved.
- SHA-256: `87321ca5e82ab0b127a5f8a3ce53223d0f091a438547a341a50f246faeb1bec4`
- Project use: the entire original 32x32 image is downsampled to 16x16 with deterministic nearest-neighbor resampling (`Image.Resampling.NEAREST`), preserving RGBA alpha, for `pet1.egg`. This is a pre-hatch egg item; it is not an early hatch animation.
