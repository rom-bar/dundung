# Original Pocket Pal character art

These 48×48 RGBA sprites are hand-authored in `scripts/build-pocket-pal-original-art.py` for Pocket Pal. The art is dedicated to the public domain under **CC0 1.0 Universal**. No third-party character pixels are traced, copied, or upscaled.

The rabbit has five element palettes and four distinct authored poses. Coal Cub has four authored poses. Sprites are designed to render at object scale 1 with the stage's integer 2× camera so one source pixel maps to two canvas pixels, matching the existing 16×16 terrain tiles at camera zoom 2.

Rebuild with `python3 scripts/build-pocket-pal-original-art.py`; inspect `manifest.json` for the exact variants and render contract.
