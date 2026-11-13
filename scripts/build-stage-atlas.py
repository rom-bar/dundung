#!/usr/bin/env python3
"""Build the Pocket Pal stage atlas from preserved CC0 source archives.

Only source pixels are used: exact 16px crops, horizontal flips, and a deterministic
palette tint for the optional slime variant. Actor animation intentionally reuses
one verified base sprite; pose/motion/expression are renderer-side scale/rotation
and overlays, not claims about unrelated source frames.
"""
from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/assets/stage"
DATA = ROOT / "src/data/stage-sprites.json"
CREATURES = ROOT / "assets-src/tiny-creatures.zip"
TOWN = ROOT / "assets-src/kenney-tiny-town.zip"
HENRY_FOOD = ROOT / "assets-src/henry-food.png"
GOOPYBUS_EGG = ROOT / "assets-src/goopybus-egg.png"
TILE = 16
ATLAS_W = 256
ATLAS_H = 256

# Each entry is (stable atlas id, archive, source member, transform).
# A member ending in #tile=N is an exact 16x16 crop from a 12-column sheet
# with one-pixel gutters (the bundled Kenney_tiny_dungeon sheet).
SPECS = [
    # Biome ground / foreground layers (Tiny Town)
    ("biome1.ground.grass", "town", "Tiles/tile_0000.png", "none"),
    ("biome1.ground.grass-detail", "town", "Tiles/tile_0001.png", "none"),
    ("biome1.ground.flower", "town", "Tiles/tile_0002.png", "none"),
    ("biome1.tree.young", "town", "Tiles/tile_0004.png", "none"),
    ("biome1.tree.round", "town", "Tiles/tile_0005.png", "none"),
    ("biome1.tree.tall", "town", "Tiles/tile_0006.png", "none"),
    ("biome1.tree.young-flip", "town", "Tiles/tile_0004.png", "flip-x"),
    ("biome1.stone.gray", "town", "Tiles/tile_0048.png", "none"),
    ("biome1.stone.blue", "town", "Tiles/tile_0049.png", "none"),
    ("biome1.stone.gray-2", "town", "Tiles/tile_0050.png", "none"),
    ("biome1.canopy.soft", "town", "Tiles/tile_0028.png", "none"),
    # Verified props / food / icons (Tiny Town)
    ("chest.closed", "creatures", "tiny-creatures/Tilemap/Kenney_tiny_dungeon.png#tile=89", "none"),
    ("chest.closed-highlight", "creatures", "tiny-creatures/Tilemap/Kenney_tiny_dungeon.png#tile=90", "none"),
    ("food.biscuit", "henry-food", "henry-food.png#crop=0,0,16,16", "none"),
    ("pet1.egg", "goopybus-egg", "goopybus-egg.png", "downsample-nearest-2x"),
    ("icon.coin", "town", "Tiles/tile_0094.png", "none"),
    ("icon.gem", "town", "Tiles/tile_0104.png", "none"),
    ("icon.bag", "town", "Tiles/tile_0109.png", "none"),
    ("icon.heart", "town", "Tiles/tile_0118.png", "none"),
    # One consistent, identifiable white rabbit base (Tiny Creatures tile 0152).
    # All named pet states reuse this source sprite; flip-x is only orientation.
    ("pet1.rabbit.idle", "creatures", "tiny-creatures/Tiles/tile_0152.png", "none"),
    ("pet1.rabbit.idle-2", "creatures", "tiny-creatures/Tiles/tile_0152.png", "flip-x"),
    ("pet1.rabbit.walk", "creatures", "tiny-creatures/Tiles/tile_0152.png", "none"),
    ("pet1.rabbit.walk-2", "creatures", "tiny-creatures/Tiles/tile_0152.png", "flip-x"),
    ("pet1.rabbit.happy", "creatures", "tiny-creatures/Tiles/tile_0152.png", "none"),
    ("pet1.rabbit.sleep", "creatures", "tiny-creatures/Tiles/tile_0152.png", "none"),
    ("pet1.rabbit.sleep-2", "creatures", "tiny-creatures/Tiles/tile_0152.png", "flip-x"),
    ("pet1.rabbit.hurt", "creatures", "tiny-creatures/Tiles/tile_0152.png", "flip-x"),
    ("pet1.rabbit.faint", "creatures", "tiny-creatures/Tiles/tile_0152.png", "none"),
    # One consistent, identifiable slime base (Tiny Creatures tile 0099).
    ("enemy1.slime.idle", "creatures", "tiny-creatures/Tiles/tile_0099.png", "none"),
    ("enemy1.slime.idle-2", "creatures", "tiny-creatures/Tiles/tile_0099.png", "flip-x"),
    ("enemy1.slime.attack", "creatures", "tiny-creatures/Tiles/tile_0099.png", "none"),
    ("enemy1.slime.hurt", "creatures", "tiny-creatures/Tiles/tile_0099.png", "flip-x"),
    ("enemy1.slime.death", "creatures", "tiny-creatures/Tiles/tile_0099.png", "none"),
    ("enemy1.slime.variant", "creatures", "tiny-creatures/Tiles/tile_0099.png", "slime-tint"),
    ("enemy1.slime.variant-2", "creatures", "tiny-creatures/Tiles/tile_0099.png", "slime-tint-flip-x"),
    # Source particles (small magic/impact glyphs, not newly drawn)
    ("particle.sparkle-1", "creatures", "tiny-creatures/Tiles/tile_0057.png", "none"),
    ("particle.sparkle-2", "creatures", "tiny-creatures/Tiles/tile_0058.png", "none"),
    ("particle.sparkle-3", "creatures", "tiny-creatures/Tiles/tile_0059.png", "none"),
    ("particle.sparkle-4", "creatures", "tiny-creatures/Tiles/tile_0060.png", "none"),
    # Verified Tiny Dungeon utility crops: floor 048, path 050, brick wall 014, torch 125.
    ("dungeon.floor", "creatures", "tiny-creatures/Tilemap/Kenney_tiny_dungeon.png#tile=48", "none"),
    ("dungeon.path", "creatures", "tiny-creatures/Tilemap/Kenney_tiny_dungeon.png#tile=50", "none"),
    ("dungeon.wall", "creatures", "tiny-creatures/Tilemap/Kenney_tiny_dungeon.png#tile=14", "none"),
    ("dungeon.torch", "creatures", "tiny-creatures/Tilemap/Kenney_tiny_dungeon.png#tile=125", "none"),
]

ELEMENT_PALETTES = {
    "fire": (248, 149, 105), "water": (129, 199, 239),
    "moss": (151, 209, 127), "storm": (246, 213, 130), "shadow": (185, 157, 221),
}
for family, tile in [("pet1.rabbit", 152), ("enemy1.slime", 99)]:
    source = f"tiny-creatures/Tiles/tile_{tile:04}.png"
    SPECS.append((f"{family}.hit-flash", "creatures", source, "white-fill"))
    for element in ELEMENT_PALETTES:
        SPECS.append((f"{family}.{element}", "creatures", source, f"palette-{element}"))
for color in ["gold", "heal", "dust"]:
    SPECS.append((f"particle.{color}", "creatures", "tiny-creatures/Tiles/tile_0057.png", f"{color}-fill"))

ANIMATIONS = {
    "pet1.idle": {"frames": ["pet1.rabbit.idle", "pet1.rabbit.idle-2"], "frameRate": 2, "repeat": -1},
    "pet1.walk": {"frames": ["pet1.rabbit.walk", "pet1.rabbit.walk-2"], "frameRate": 6, "repeat": -1},
    "pet1.attack": {"frames": ["pet1.rabbit.happy", "pet1.rabbit.idle"], "frameRate": 8, "repeat": 0},
    "pet1.hurt": {"frames": ["pet1.rabbit.hurt", "pet1.rabbit.idle"], "frameRate": 5, "repeat": 0},
    "pet1.eat": {"frames": ["pet1.rabbit.happy", "pet1.rabbit.idle", "pet1.rabbit.happy"], "frameRate": 4, "repeat": 0},
    "pet1.sleep": {"frames": ["pet1.rabbit.sleep", "pet1.rabbit.sleep-2"], "frameRate": 2, "repeat": -1},
    "pet1.happy": {"frames": ["pet1.rabbit.happy", "pet1.rabbit.idle-2"], "frameRate": 5, "repeat": 1},
    "pet1.faint": {"frames": ["pet1.rabbit.faint", "pet1.rabbit.sleep"], "frameRate": 3, "repeat": 0},
    "enemy1.idle": {"frames": ["enemy1.slime.idle", "enemy1.slime.idle-2"], "frameRate": 3, "repeat": -1},
    "enemy1.attack": {"frames": ["enemy1.slime.attack", "enemy1.slime.idle"], "frameRate": 7, "repeat": 0},
    "enemy1.hurt": {"frames": ["enemy1.slime.hurt", "enemy1.slime.idle"], "frameRate": 6, "repeat": 0},
    "enemy1.death": {"frames": ["enemy1.slime.death", "enemy1.slime.idle"], "frameRate": 5, "repeat": 0},
    "enemy1.variant-idle": {"frames": ["enemy1.slime.variant", "enemy1.slime.variant-2"], "frameRate": 3, "repeat": -1},
    "chest.open": {"frames": ["chest.closed", "chest.closed-highlight"], "frameRate": 4, "repeat": 0},
    "particle.sparkle": {"frames": ["particle.sparkle-1", "particle.sparkle-2", "particle.sparkle-3", "particle.sparkle-4"], "frameRate": 12, "repeat": 0},
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_source(archive: str, member: str) -> tuple[Image.Image, int | None, str]:
    paths = {"creatures": CREATURES, "town": TOWN, "henry-food": HENRY_FOOD, "goopybus-egg": GOOPYBUS_EGG}
    path = paths[archive]
    if archive in {"henry-food", "goopybus-egg"}:
        source_member, sep, crop = member.partition("#crop=")
        source = Image.open(path).convert("RGBA")
        if sep:
            coords = tuple(int(value) for value in crop.split(","))
            if len(coords) != 4:
                raise ValueError(f"{member}: crop must be x0,y0,x1,y1")
            source = source.crop(coords)
        return source, None, member
    source_member, sep, suffix = member.partition("#tile=")
    source_index = int(suffix) if sep else None
    # The individual Tiny Creatures P-mode tiles omit transparency metadata.
    # Exact crops from the supplied RGBA master preserve the original alpha,
    # including outline and eye pixels; do not color-key black out of the art.
    individual = re.fullmatch(r"tiny-creatures/Tiles/tile_(\d+)\.png", source_member)
    if archive == "creatures" and individual:
        source_member = "tiny-creatures/Tilemap/tilemap.png"
        source_index = int(individual.group(1))
    with zipfile.ZipFile(path) as zf:
        with zf.open(source_member) as fh:
            source = Image.open(fh).convert("RGBA")
    if source_index is None:
        return source, None, source_member
    if source.width < 16 or source.height < 16:
        raise ValueError(f"{member}: source sheet is smaller than 16x16")
    cols = (source.width + 1) // 17
    x = (source_index % cols) * 17
    y = (source_index // cols) * 17
    cropped = source.crop((x, y, x + TILE, y + TILE))
    return cropped, source_index, source_member


def transform(im: Image.Image, kind: str) -> Image.Image:
    if kind == "downsample-nearest-2x":
        if im.size != (32, 32):
            raise ValueError(f"downsample-nearest-2x expects 32x32, got {im.size}")
        return im.resize((16, 16), Image.Resampling.NEAREST)
    if kind == "flip-x":
        return im.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    fills = {"white-fill": (255, 255, 255), "gold-fill": (255, 221, 142), "heal-fill": (185, 238, 185), "dust-fill": (225, 208, 158)}
    if kind in fills or kind.startswith("palette-"):
        out = im.copy()
        pixels = out.load()
        for y in range(out.height):
            for x in range(out.width):
                r, g, b, a = pixels[x, y]
                if not a:
                    continue
                if kind in fills:
                    pixels[x, y] = (*fills[kind], a)
                else:
                    target = ELEMENT_PALETTES[kind.removeprefix("palette-")]
                    light = (r * 2 + g * 7 + b) / 2550
                    pixels[x, y] = (*(round(channel * light) for channel in target), a)
        return out
    if kind == "slime-tint":
        out = im.copy()
        px = out.load()
        for y in range(out.height):
            for x in range(out.width):
                r, g, b, a = px[x, y]
                if a:
                    px[x, y] = (min(255, int(r * 0.65)), min(255, int(g * 1.05 + 18)), min(255, int(b * 0.82 + 12)), a)
        return out
    if kind == "slime-tint-flip-x":
        return transform(transform(im, "slime-tint"), "flip-x")
    return im


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    atlas = Image.new("RGBA", (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    frames: dict[str, dict] = {}
    manifest: list[dict] = []
    x = y = 0
    for name, archive, member, kind in SPECS:
        source_im, source_index, source_member = load_source(archive, member)
        im = transform(source_im, kind)
        if im.size != (TILE, TILE):
            raise ValueError(f"{name}: expected 16x16, got {im.size}")
        if x + TILE > ATLAS_W:
            x = 0
            y += TILE
        if y + TILE > ATLAS_H:
            raise ValueError("atlas is too small")
        atlas.paste(im, (x, y), im)
        frames[name] = {"frame": {"x": x, "y": y, "w": TILE, "h": TILE}, "rotated": False, "trimmed": False, "spriteSourceSize": {"x": 0, "y": 0, "w": TILE, "h": TILE}, "sourceSize": {"w": TILE, "h": TILE}}
        entry = {"id": name, "sourceArchive": archive, "sourceMember": source_member, "transform": kind, "tileSize": [TILE, TILE]}
        if source_index is not None:
            entry["sourceIndex"] = source_index
        manifest.append(entry)
        x += TILE
    atlas.save(OUT / "atlas.png", optimize=False)
    (OUT / "atlas.json").write_text(json.dumps({"frames": frames, "meta": {"app": "Pocket Pal stage atlas builder", "version": "1.1", "image": "atlas.png", "format": "RGBA8888", "size": {"w": ATLAS_W, "h": ATLAS_H}, "scale": "1"}}, indent=2) + "\n")
    DATA.write_text(json.dumps({"texture": "stage/atlas", "tileSize": 16, "frames": frames, "animations": ANIMATIONS, "layers": [{"id": "biome1.far", "parallax": 0.72, "frames": ["biome1.canopy.soft", "biome1.tree.tall"]}, {"id": "biome1.mid", "parallax": 0.88, "frames": ["biome1.tree.round", "biome1.tree.young", "biome1.stone.gray"]}, {"id": "biome1.ground", "parallax": 1, "frames": ["biome1.ground.grass", "biome1.ground.grass-detail", "biome1.ground.flower", "biome1.stone.blue"]}, {"id": "dungeon", "parallax": 1, "frames": ["dungeon.floor", "dungeon.path", "dungeon.wall", "dungeon.torch"]}], "sourceTransforms": {"palette-*": "original alpha and luminosity mapped to the documented element color", "*-fill": "solid color through original source alpha, for Canvas-compatible hit flashes and tiny particles", "flip-x": "deterministic horizontal flip of original source tile", "slime-tint": "deterministic tint of original slime pixels; no geometry added", "slime-tint-flip-x": "deterministic tint followed by horizontal flip", "downsample-nearest-2x": "full 32x32 RGBA source resized to 16x16 with nearest-neighbor sampling; alpha preserved", "crop": "sourceMember records the original PNG filename and crop coordinates", "procedural-actor-motion": "pet/slime state changes reuse one verified base sprite; renderer may apply scale/rotation/food overlay and must not imply alternate source poses"}, "semanticChoices": {"pet1": "All pet1.rabbit.* frames use Tiny Creatures tile 0152 (white rabbit); only orientation, alpha-preserving flash, and element palette variants differ.", "enemy1": "All enemy1.slime.* frames use Tiny Creatures tile 0099 (green slime-like creature); only orientation, alpha-preserving flash, and element palette variants differ.", "chest": "chest.closed is Tiny Dungeon sheet tile 089 and chest.closed-highlight is tile 090 (same chest closed/open), not the Tiny Town door icons.", "food": "food.biscuit is the first 16x16 tile of Henry Software's henry-food.png, a cookie with chocolate chips.", "egg": "pet1.egg is the full GoopyBus 32x32 RGBA egg downsampled to 16x16 nearest-neighbor; it remains a pre-hatch egg.", "dungeonUtilities": "Tiny Dungeon sheet tiles 048, 050, 014, and 125 provide floor, path, wall, and torch."}}, indent=2) + "\n")
    (OUT / "asset-manifest.json").write_text(json.dumps({"generatedBy": "scripts/build-stage-atlas.py", "sources": manifest, "archiveSha256": {"assets-src/tiny-creatures.zip": sha256(CREATURES), "assets-src/kenney-tiny-town.zip": sha256(TOWN), "assets-src/henry-food.png": sha256(HENRY_FOOD), "assets-src/goopybus-egg.png": sha256(GOOPYBUS_EGG)}}, indent=2) + "\n")
    credits = ROOT / "CREDITS.md"
    credits.write_text("""# Stage art credits

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
""")


if __name__ == "__main__":
    main()
