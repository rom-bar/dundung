# Round 1 — geometry and composition are not ready

These are actual production-preview screenshots, not generated comps. The seven named views use presentation-only, frozen event fixtures; the separate seeded-run E2E suite proves gameplay. Preview fixtures do not change the Worker seed. All seven views and eight attack frames were captured at both requested viewports, then opened for review against the owner's Stardew Valley world and IdleOn HUD references in `docs/reference/`.

[Portrait states](round-1/phone-360/states-contact.png) · [Landscape states](round-1/landscape-740/states-contact.png) · [Eight attack frames](round-1/phone-360/attack-contact.png). Individual full-size captures are beside these contact sheets, in corridor, intro, attack, crit, chest, home, eating order.

## What differs from the references

1. **Aspect ratio:** the fixed 240×160 drawing is stretched over a very wide landscape box. Pip and the enemy become flat. The references keep every sprite square regardless of layout.
2. **Sprite scale:** Pip's source tile is enlarged to dominate almost half the scene and its coarse outline overwhelms its expression. Aim for roughly 28–35% of the stage height, not the present giant block.
3. **Depth:** the three scenery layers exist technically, but oversized repeated tiles flatten into three horizontal bands. Distant trees must be smaller and less saturated, with distinct middle and foreground placement.
4. **Ground:** large peach floor slabs and alternating gray wall blocks take most of the composition. The references use a recognizable continuous path inside a richly colored world, not isolated huge rectangles.
5. **Combat composition:** the attack/crit preview wrongly retains the home scene when no real run is active. The enemy disappears while damage floats above empty space. Correct the fixture-to-scene mapping before judging attack readability.
6. **Particle language:** large dark, rotating texture fragments look like detached objects rather than dust or warm impact sparkles. They compete with the actor and need much smaller, brighter silhouettes, emitted at impact rather than the first wind-up frame.
7. **Motion:** the eight-frame strip changes Pip's x-position and squash, but has no clear held anticipation or impact beat. The damage number is already visible in the first frame. Separate anticipation, contact, hit-stop and recovery.
8. **HUD scale:** the sandy DOM action row is a step toward the references, but its tiny glyphs and status numerals are not a coherent icon system. Keep labels readable at 360px and use a consistent icon treatment.
9. **Home versus corridor:** both show the same scrolling ground and wall bands. Home should read as a still glade, while corridor travel should drive parallax.
10. **Labels:** preview fixtures still show HOME and a home caption. This is misleading visual evidence even though real run labels are state-driven; mark preview views accurately without changing game state.
11. **Lighting:** there is no quiet sky or atmospheric separation. The references reserve a lighter distant plane and darker foreground edges so the actor stands out.
12. **Chest and eating:** the chest/banner and food motion are present but overlap large actors and dark effects, making the reward/consumption hard to read.

## Scores, 1–10

| Readability | Art cohesion | Animation feel | Juice | Reference match |
|---:|---:|---:|---:|---:|
| 3 | 3 | 3 | 3 | 2 |

**Verdict: do not call this polished.** First fix responsive camera/backing-store geometry, a smaller consistent actor scale, a layered forest/path composition, and correct battle preview visibility. Then refine impact timing and particles in the next round. Both capture tests passed and reported no console errors or page overflow; that functional pass does not make the art acceptable.
