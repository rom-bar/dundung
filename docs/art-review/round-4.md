# Round 4 — the scene is coherent; polish must work in the actual renderer

Viewed [portrait states](round-4/phone-360/states-contact.png), [landscape states](round-4/landscape-740/states-contact.png), [the attack strip](round-4/phone-360/attack-contact.png), and the full-size crit screenshot against the owner's references. The camera now centers the battle correctly in both orientations. Grass fills the entire floor; a sourced path, edge foliage and contact shadows make the actors feel grounded. No blank half-screen remains in landscape.

## Eight-plus specific comparisons

1. **Composition:** the corrected centered battle and persistent forest are substantially closer to the reference game layouts. Keep this; do not return to boxed stats panels.
2. **Depth:** distant tinted trees, a middle tree line and foreground edges now read as separate planes. Some repeated silhouettes still look simpler than the detailed references, but belong to the chosen 16px family.
3. **Typography:** Canvas text still uses a system monospace face, unlike the app's locally bundled pixel lettering. Use the actual game font and scale it to readable CSS equivalents.
4. **Small stage metadata:** the Egg/location badges and caption remain undersized at 360px. Raise them to 14px without increasing the fixed screen height.
5. **White flash:** the target does not become visibly white in the impact samples. This is not a timing problem: Phaser's Canvas renderer does not implement the WebGL tint-fill path. Bake a white recolor through the original sprite alpha into the atlas.
6. **Particles:** tiny dark face fragments are still visible around the slime. Recolor the preserved source alpha before packing, so Canvas displays small warm/gold shards instead of ignoring `setTintFill`.
7. **Element variants:** runtime tint calls have the same Canvas limitation. Bake the five luminosity-preserving palette variants into the atlas; keep one base body rather than drawing unrelated species.
8. **Motion:** the attack strip now contains a wind-up, fast approach, two held contact samples and recovery. Keep its pure sampled curve and test the impact interval; add flash/particles on the same beat rather than moving the damage number earlier.
9. **Camera juice:** the subtle follow and crit punch are now visible in composition shifts; keep the amplitude restrained and disable it for reduced motion.
10. **Food:** the separate snack overlay reaches the cat rather than becoming its body. It remains a very small icon, not a hand-authored eating pose; do not describe it as a new source animation.
11. **Idle detail:** breathing and turning are present, but the pack has no separate authored blink or ear frames for this cat. The implementation must not pretend mirrored unrelated animals are alternate poses.
12. **Scope:** the home preview is the same still meadow, not the future decorated home room. This deliberately stays within the slice; the richer room and equipment layers await owner approval.

## Scores, 1–10

| Readability | Art cohesion | Animation feel | Juice | Reference match |
|---:|---:|---:|---:|---:|
| 7 | 7 | 7 | 6 | 7 |

**Next fixes:** Canvas-compatible atlas flash and recolored small effects; real pixel font; 14px stage metadata; bake element colors; split the scene and its metadata into the lazy bundle, then recapture. The build/typecheck and 105 unit tests passed. Both orientation captures passed with no console errors or page overflow. One more round is required rather than awarding an unearned pass to effects that exist only in code.
