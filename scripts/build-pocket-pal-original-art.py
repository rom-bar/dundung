#!/usr/bin/env python3
"""Build original, CC0 Pocket Pal character sprites on a 48px pixel grid.

All geometry in this script is authored for Pocket Pal. It does not copy or
upscale any third-party character art. Frames have transparent RGBA backgrounds
and are designed to render at 1x sprite scale with the stage's existing 2x camera.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "assets-src/pocket-pal-original"
PREVIEW = ROOT / "docs/art-review/feedback/assets-v1-preview.png"
SIZE = 48

PALETTES = {
    "fire": {"coat_dark": "#9b5140", "coat_mid": "#d67550", "coat_light": "#f3a16d", "coat_bright": "#ffcf91"},
    "water": {"coat_dark": "#456f86", "coat_mid": "#619fbd", "coat_light": "#8bcce8", "coat_bright": "#d2f0f2"},
    "moss": {"coat_dark": "#526f45", "coat_mid": "#79a960", "coat_light": "#a8d17d", "coat_bright": "#d9edaf"},
    "storm": {"coat_dark": "#88643f", "coat_mid": "#c29a4e", "coat_light": "#e8c86b", "coat_bright": "#fff0ad"},
    "shadow": {"coat_dark": "#6c547e", "coat_mid": "#9278aa", "coat_light": "#bba5d1", "coat_bright": "#e2d5ef"},
}
COMMON = {
    "outline": "#30212a",
    "outline_lit": "#58404a",
    "skin": "#fff0cf",
    "skin_shadow": "#cdb58f",
    "ear": "#df7b80",
    "eye": "#211820",
    "eye_glint": "#fff9e7",
    "nose": "#a94650",
}
POSES = {
    "idle": {"body_y": 0, "ear_y": 0, "back_foot": (13, 39), "front_foot": (31, 39)},
    "walk-a": {"body_y": 0, "ear_y": -1, "back_foot": (9, 39), "front_foot": (34, 37)},
    "walk-b": {"body_y": -1, "ear_y": 1, "back_foot": (17, 37), "front_foot": (28, 39)},
    "hurt": {"body_y": 1, "ear_y": 2, "back_foot": (14, 39), "front_foot": (29, 39)},
}


def shift(points: Iterable[tuple[int, int]], dx: int = 0, dy: int = 0) -> list[tuple[int, int]]:
    return [(x + dx, y + dy) for x, y in points]


def polygon(draw: ImageDraw.ImageDraw, points: Iterable[tuple[int, int]], color: str) -> None:
    draw.polygon(list(points), fill=color)


def draw_rabbit(pose_name: str, palette_name: str) -> Image.Image:
    pose = POSES[pose_name]
    colors = {**COMMON, **PALETTES[palette_name]}
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    by = pose["body_y"]
    ey = pose["ear_y"]

    # Two stepped ears, with the back ear partly hidden behind the head.
    polygon(d, shift([(22, 23), (22, 17), (23, 8), (25, 4), (29, 3), (32, 6), (33, 16), (31, 23)], 0, by + ey), colors["outline"])
    polygon(d, shift([(25, 18), (25, 9), (27, 6), (29, 6), (30, 9), (30, 18), (29, 22)], 0, by + ey), colors["coat_mid"])
    polygon(d, shift([(27, 17), (27, 9), (28, 8), (29, 9), (29, 17)], 0, by + ey), colors["ear"])
    polygon(d, shift([(31, 23), (31, 17), (33, 9), (36, 5), (40, 6), (42, 10), (40, 19), (37, 25)], 0, by + ey), colors["outline"])
    polygon(d, shift([(34, 18), (35, 10), (37, 8), (39, 9), (39, 17), (37, 22)], 0, by + ey), colors["coat_light"])
    polygon(d, shift([(36, 17), (37, 11), (38, 10), (38, 17)], 0, by + ey), colors["ear"])

    # Tail, body and head are one readable rabbit silhouette with a fine dark edge.
    d.ellipse((3, 26 + by, 14, 37 + by), fill=colors["outline"])
    d.ellipse((5, 28 + by, 12, 35 + by), fill=colors["skin"])
    body = [(7, 31), (8, 27), (12, 24), (17, 22), (22, 22), (27, 24), (30, 21), (33, 19),
            (37, 20), (41, 23), (44, 27), (46, 29), (45, 33), (42, 35), (41, 40),
            (38, 44), (32, 44), (29, 40), (23, 40), (21, 44), (16, 44), (13, 40),
            (9, 38), (7, 35)]
    polygon(d, shift(body, 0, by), colors["outline"])
    inside = [(10, 31), (11, 28), (14, 26), (19, 24), (23, 24), (28, 26), (31, 23), (34, 21),
              (37, 22), (40, 25), (43, 28), (42, 31), (39, 33), (38, 39), (36, 41),
              (33, 41), (30, 38), (22, 38), (20, 41), (17, 41), (15, 38), (11, 36)]
    polygon(d, shift(inside, 0, by), colors["coat_mid"])
    polygon(d, shift([(13, 29), (17, 26), (23, 26), (28, 28), (27, 33), (22, 36), (16, 35)], 0, by), colors["coat_light"])
    polygon(d, shift([(17, 32), (20, 30), (24, 31), (26, 35), (23, 38), (18, 37)], 0, by), colors["coat_bright"])
    polygon(d, shift([(30, 25), (33, 22), (37, 23), (40, 26), (40, 29), (36, 30), (32, 29)], 0, by), colors["coat_light"])
    polygon(d, shift([(35, 29), (38, 28), (43, 29), (42, 32), (38, 33), (35, 32)], 0, by), colors["skin"])
    polygon(d, shift([(39, 25), (41, 25), (42, 27), (40, 28), (39, 27)], 0, by), colors["eye"])
    im.putpixel((40, 25 + by), Image.new("RGBA", (1, 1), colors["eye_glint"]).getpixel((0, 0)))
    polygon(d, shift([(44, 28), (46, 29), (44, 31), (42, 30)], 0, by), colors["nose"])

    # Short forelegs and hind legs carry the movement; pose changes are real source pixels.
    back_x, foot_y = pose["back_foot"]
    front_x, front_y = pose["front_foot"]
    for x, y in ((back_x, foot_y), (front_x, front_y)):
        polygon(d, [(x - 2, y - 4 + by), (x + 5, y - 4 + by), (x + 7, y - 1 + by), (x + 6, y + 2 + by), (x - 2, y + 2 + by), (x - 4, y + 0 + by)], colors["outline"])
        polygon(d, [(x - 1, y - 2 + by), (x + 4, y - 2 + by), (x + 5, y + by), (x - 1, y + by)], colors["coat_dark"])
        d.line([(x + 1, y - 1 + by), (x + 3, y - 1 + by)], fill=colors["coat_bright"], width=1)

    # An extended paw in the hurt pose and a soft forelock keep the silhouette expressive.
    if pose_name == "hurt":
        polygon(d, shift([(34, 32), (39, 31), (43, 33), (42, 36), (36, 36)], 0, by), colors["outline"])
        polygon(d, shift([(36, 33), (40, 33), (41, 34), (37, 35)], 0, by), colors["coat_light"])
    polygon(d, shift([(29, 20), (31, 18), (33, 18), (34, 20)], 0, by), colors["coat_bright"])
    return im


CUB_POSES = {
    "idle": {"body_y": 0, "feet": ((13, 39), (31, 39))},
    "hop-a": {"body_y": -1, "feet": ((9, 37), (34, 39))},
    "hop-b": {"body_y": 0, "feet": ((17, 39), (27, 37))},
    "hurt": {"body_y": 1, "feet": ((14, 39), (30, 39))},
}


def draw_coal_cub(pose_name: str) -> Image.Image:
    pose = CUB_POSES[pose_name]
    by = pose["body_y"]
    c = {
        "outline": "#30212a", "outline_lit": "#58404a", "coal": "#4a3036",
        "fur_dark": "#775047", "fur": "#a46d55", "fur_light": "#cf9670",
        "muzzle": "#ead0a8", "eye": "#241923", "glint": "#fff6df", "nose": "#d07870",
    }
    im = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # Ears and rounded head/body silhouette, facing the pet.
    polygon(d, shift([(8, 20), (8, 12), (11, 7), (16, 9), (20, 14), (18, 21)], 0, by), c["outline"])
    polygon(d, shift([(11, 15), (12, 10), (15, 12), (17, 16)], 0, by), c["fur_light"])
    polygon(d, shift([(30, 17), (33, 11), (38, 8), (42, 11), (42, 20), (36, 22)], 0, by), c["outline"])
    polygon(d, shift([(35, 16), (37, 12), (39, 12), (40, 17), (37, 19)], 0, by), c["fur_light"])
    silhouette = [(8, 24), (10, 18), (15, 14), (21, 12), (28, 12), (34, 15), (39, 20), (42, 26),
                  (42, 34), (39, 39), (34, 42), (29, 43), (27, 40), (21, 40), (18, 43),
                  (13, 41), (9, 37), (6, 31)]
    polygon(d, shift(silhouette, 0, by), c["outline"])
    inner = [(11, 25), (13, 20), (17, 17), (22, 15), (28, 15), (33, 17), (37, 21), (39, 26),
             (39, 33), (36, 37), (32, 39), (28, 37), (21, 37), (17, 39), (13, 36), (10, 31)]
    polygon(d, shift(inner, 0, by), c["fur"])
    polygon(d, shift([(12, 25), (15, 21), (19, 19), (25, 18), (31, 20), (35, 23), (35, 27), (30, 28), (24, 27), (17, 29)], 0, by), c["fur_light"])
    # A small coal-dark tuft explains the name without obscuring the face.
    polygon(d, shift([(18, 17), (19, 13), (22, 16), (24, 11), (26, 16), (29, 13), (31, 18)], 0, by), c["coal"])
    # Eyes, mask, nose, mouth and cheek spots.
    polygon(d, shift([(15, 25), (18, 23), (21, 24), (21, 28), (18, 29), (15, 27)], 0, by), c["outline"])
    polygon(d, shift([(29, 24), (32, 23), (35, 25), (34, 28), (31, 29), (29, 27)], 0, by), c["outline"])
    im.putpixel((17, 24 + by), Image.new("RGBA", (1, 1), c["glint"]).getpixel((0, 0)))
    im.putpixel((31, 24 + by), Image.new("RGBA", (1, 1), c["glint"]).getpixel((0, 0)))
    polygon(d, shift([(20, 29), (23, 27), (29, 27), (33, 29), (32, 33), (28, 35), (23, 34), (20, 32)], 0, by), c["muzzle"])
    polygon(d, shift([(25, 29), (28, 29), (29, 31), (27, 32), (25, 31)], 0, by), c["nose"])
    d.line(shift([(27, 32), (27, 34), (24, 35)], 0, by), fill=c["outline"], width=1)
    d.line(shift([(28, 34), (31, 35)], 0, by), fill=c["outline"], width=1)
    # A dark bib and two feet ground the round body.
    polygon(d, shift([(15, 33), (19, 35), (22, 37), (29, 37), (33, 35), (35, 38), (31, 40), (19, 40), (15, 38)], 0, by), c["fur_dark"])
    for x, y in pose["feet"]:
        polygon(d, [(x - 2, y - 4 + by), (x + 5, y - 4 + by), (x + 7, y - 1 + by), (x + 6, y + 2 + by), (x - 2, y + 2 + by), (x - 4, y + by)], c["outline"])
        polygon(d, [(x - 1, y - 2 + by), (x + 4, y - 2 + by), (x + 5, y + by), (x - 1, y + by)], c["fur_dark"])
    if pose_name == "hurt":
        d.line([(12, 24 + by), (16, 22 + by)], fill=c["nose"], width=2)
        d.line([(35, 23 + by), (39, 25 + by)], fill=c["nose"], width=2)
    return im


def make_preview() -> None:
    # Place real 2x nearest-neighbour sprites over the project's existing grass tile.
    atlas = Image.open(ROOT / "public/assets/stage/atlas.png").convert("RGBA")
    grass = atlas.crop((0, 0, 16, 16)).resize((32, 32), Image.Resampling.NEAREST)
    names = [("fire", "idle"), ("water", "idle"), ("moss", "walk-a"), ("storm", "walk-b"), ("shadow", "hurt"), ("cub", "idle")]
    cell = 144
    board = Image.new("RGB", (cell * 3, cell * 2), "#a6ccba")
    for index, (element, pose_name) in enumerate(names):
        x0 = (index % 3) * cell
        y0 = (index // 3) * cell
        for y in range(y0 + 78, y0 + cell, 32):
            for x in range(x0, x0 + cell, 32):
                board.paste(grass.convert("RGB"), (x, y))
        # Ground shadow uses a flat, low-contrast ellipse; character art remains transparent.
        d = ImageDraw.Draw(board)
        d.ellipse((x0 + 22, y0 + 119, x0 + 122, y0 + 133), fill="#527b54")
        source = draw_coal_cub(pose_name) if element == "cub" else draw_rabbit(pose_name, element)
        sprite = source.resize((96, 96), Image.Resampling.NEAREST)
        board.paste(sprite, (x0 + 24, y0 + 28), sprite)
    PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    board.save(PREVIEW)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for element in PALETTES:
        for pose_name in POSES:
            draw_rabbit(pose_name, element).save(OUT / f"rabbit-{element}-{pose_name}.png")
    for pose_name in CUB_POSES:
        draw_coal_cub(pose_name).save(OUT / f"coal-cub-{pose_name}.png")
    manifest = {
        "license": "CC0-1.0",
        "author": "Pocket Pal project contributors",
        "source": "Original pixel geometry authored in scripts/build-pocket-pal-original-art.py; no third-party art copied.",
        "frameSize": [SIZE, SIZE],
        "renderScale": {"sprite": 1, "cameraZoom": 2, "sourcePixelOutputPixels": 2},
        "petPalettes": list(PALETTES),
        "petPoses": list(POSES),
        "enemy": "coal-cub",
        "enemyPoses": list(CUB_POSES),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    (OUT / "README.md").write_text(
        "# Original Pocket Pal character art\n\n"
        "These 48×48 RGBA sprites are hand-authored in `scripts/build-pocket-pal-original-art.py` for Pocket Pal. "
        "The art is dedicated to the public domain under **CC0 1.0 Universal**. No third-party character pixels are traced, copied, or upscaled.\n\n"
        "The rabbit has five element palettes and four distinct authored poses. Coal Cub has four authored poses. "
        "Sprites are designed to render at object scale 1 with the stage's integer 2× camera so one source pixel maps to two canvas pixels, matching the existing 16×16 terrain tiles at camera zoom 2.\n\n"
        "Rebuild with `python3 scripts/build-pocket-pal-original-art.py`; inspect `manifest.json` for the exact variants and render contract.\n",
        encoding="utf-8",
    )
    make_preview()
    print(f"Generated 24 original 48x48 CC0 sprites in {OUT}")
    print(f"Preview: {PREVIEW}")


if __name__ == "__main__":
    main()
