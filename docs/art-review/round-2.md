# Round 2 — proportions improved; world and timing still weak

Opened the seven portrait and seven landscape states and the eight-frame attack contact sheet, then compared them with the owner's bright, layered pixel-RPG references. [Portrait](round-2/phone-360/states-contact.png) · [Landscape](round-2/landscape-740/states-contact.png) · [Attack sequence](round-2/phone-360/attack-contact.png).

The backing canvas now follows the actual viewport, the camera uses an integer base zoom, actors are smaller, the enemy is present in battle previews, and the duplicate caption no longer covers the scene. These are real improvements, but not a polished result.

## Specific differences still visible

1. **Transparency:** every cat/slime is surrounded by an opaque black square. Inspection proved the individual Tiny Creatures PNGs are palette images without transparency metadata; the supplied RGBA master sheet has correct alpha. Repack exact crops from that master. Do not remove black by color key, which would destroy eyes and outlines.
2. **Landscape coverage:** trees and floor start near the middle, leaving a large empty cyan region on the left. Position a stable layer pool relative to the current camera bounds, not fixed positive world coordinates.
3. **Corridor identity:** walking hides the forest layers and leaves floating torches beneath a thin wall strip. The reference-like forest must remain present, with travel parallax separating its three planes.
4. **Grounding:** the bottom grass strip does not fill down to the viewport edge and leaves a cyan gap beneath it. Use a continuous tiled ground plane with a narrower readable path.
5. **Palette and depth:** sky, tree rows and floor still read as bands. Desaturate the far plane and use foreground edge foliage rather than identical rows of trees.
6. **Unit HUD:** the two unit bars are visible, but their position is detached from actor heads and they lack a dark track. Keep them slim, attached to each unit, and unobtrusive.
7. **Attack timing:** the frame strip shows movement but damage is visible before contact. Add a held wind-up, decisive eased lunge, a short impact hold, then a visible recovery; show numbers only after impact.
8. **Impact clarity:** no white hit flash or convincing knockback is visible. The target should react at the same contact beat as sparks, camera response and sound.
9. **Effects:** dark rotating fragments remain much too large and look like loose creature tiles. Retain source-art provenance but shrink and tint them into small warm shards, with pooled lifetimes and one emission per impact.
10. **Home/eating:** home is now still, but the food drifts above Pip instead of clearly reaching the mouth; keep the biscuit small and anchor its final position to the pet.
11. **Typography:** the intro banner competes with the top HUD and some status numerals remain tiny. Bound banner width to the viewport and make the stage text readable in both orientations.
12. **Art consistency:** the references use consistently sized world details; present tree sizes, torch scale and unit scales still need one deliberate density hierarchy.

## Scores, 1–10

| Readability | Art cohesion | Animation feel | Juice | Reference match |
|---:|---:|---:|---:|---:|
| 5 | 5 | 3 | 4 | 4 |

**Next fixes:** preserve the original RGBA master alpha; cover the full camera with forest, path and ground; implement the actual anticipation/contact/recovery model; then synchronize flash, knockback, small particles and sound. Both capture tests passed with no page overflow or console errors. No new reference or asset download is required to fix these technical issues.
