#!/usr/bin/env python3
"""Pack reviewed Pocket Pal character poses into deterministic Phaser sheets."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets-src/pocket-pal-original"
OUTPUT = ROOT / "public/assets/stage/characters"
SIZE = 48
SHEETS = {
    "rabbit-fire": ["idle", "walk-a", "walk-b", "hurt"],
    "rabbit-water": ["idle", "walk-a", "walk-b", "hurt"],
    "rabbit-moss": ["idle", "walk-a", "walk-b", "hurt"],
    "rabbit-storm": ["idle", "walk-a", "walk-b", "hurt"],
    "rabbit-shadow": ["idle", "walk-a", "walk-b", "hurt"],
    "coal-cub": ["idle", "hop-a", "hop-b", "hurt"],
}

OUTPUT.mkdir(parents=True, exist_ok=True)
manifest: dict[str, object] = {"frameWidth": SIZE, "frameHeight": SIZE, "sheets": {}}

for sheet_name, poses in SHEETS.items():
    sheet = Image.new("RGBA", (SIZE * len(poses), SIZE), (0, 0, 0, 0))
    source_hashes: dict[str, str] = {}
    for index, pose in enumerate(poses):
        source_path = SOURCE / f"{sheet_name}-{pose}.png"
        with Image.open(source_path) as opened:
            frame = opened.convert("RGBA")
        if frame.size != (SIZE, SIZE):
            raise ValueError(f"{source_path} is {frame.size}, expected {(SIZE, SIZE)}")
        if frame.getpixel((0, 0))[3] != 0:
            raise ValueError(f"{source_path} has a nontransparent corner")
        sheet.alpha_composite(frame, (index * SIZE, 0))
        source_hashes[pose] = hashlib.sha256(source_path.read_bytes()).hexdigest()
    target = OUTPUT / f"{sheet_name}.png"
    sheet.save(target, format="PNG", optimize=False, compress_level=9)
    manifest["sheets"][sheet_name] = {
        "file": target.name,
        "frameCount": len(poses),
        "frameOrder": poses,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "sourceSha256": source_hashes,
    }

(OUTPUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(f"Built {len(SHEETS)} character sheets at {OUTPUT}")
