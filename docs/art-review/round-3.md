# Round 3 — recognizable sourced art, but the viewport still exposes structural flaws

Opened [all portrait states](round-3/phone-360/states-contact.png), [all landscape states](round-3/landscape-740/states-contact.png), and [eight attack samples](round-3/phone-360/attack-contact.png). Alpha is now preserved from the original RGBA master: the cat and slime finally have clean silhouettes, and the chest is recognizable. The sequence now shows anticipation, contact and recovery instead of damage from frame one.

## Differences from the owner's references

1. **Landscape framing remains wrong:** camera bounds clamp the center and put the actors on the left, while the forest ends halfway across the view. Remove the clamping and place layers relative to the actual centered camera.
2. **Ground is only a strip:** cyan still appears beneath or between the floor and its edge. The references ground characters on a complete continuous surface, so use a tiled ground plane sized to the view's bottom.
3. **Forest repetition is mechanical:** three tightly repeated tree rows look like shelves. Separate a tinted distant plane, a natural middle line, and sparse foreground framing instead of another full row.
4. **Travel barely reads:** layer motion depends on a preview-freeze flag that also freezes normal gameplay by default. Freeze only an active frozen preview or a decision; normal corridor travel must advance independently.
5. **Actor-to-ground alignment:** the cat looks better, but the feet and slime lack contact shadows and a clear path. Add restrained presentation shadows and a narrow sourced path, not new hand-drawn sprites.
6. **Impact flash is unreliable:** a delayed callback clears tint while per-frame enemy tint overwrites it. Derive white flash directly from event progress so it lasts across the intended impact interval and vanishes predictably.
7. **Juice is incomplete:** attack phases improved, but camera follow, damage-scaled shake and crit punch are absent in the actual implementation. Add them without touching Worker state, and disable them under reduced motion.
8. **Particle lifetimes are frozen:** the normal-play freeze bug also prevents pool expiry. Keep a single cosmetic clock, cap the pool, expire particles and use tiny bright shards rather than large full-frame creature fragments.
9. **Unit bars need attachment:** bars remain near fixed coordinates instead of following moving heads. Attach them to the current actor bounds and add unobtrusive dark tracks.
10. **Animation definitions are duplicated:** runtime frame definitions still duplicate the data file. Load animation names, frames and rates from `stage-sprites.json`, then select poses from those definitions.
11. **Chest/eating timing:** the chest is readable now, but its loop and food target should follow event progress exactly; the biscuit must visibly reach the cat's mouth before disappearing.
12. **Stage text/intro:** the banner can collide with the portrait top HUD. Position it relative to the viewport's top, below the HUD; preserve at least 14px-equivalent stage text.

## Scores, 1–10

| Readability | Art cohesion | Animation feel | Juice | Reference match |
|---:|---:|---:|---:|---:|
| 6 | 6 | 6 | 5 | 5 |

**Round 4 priorities:** fix the camera/ground coverage structurally, make normal animation clocks run, use animation data directly, synchronize contact flash/knockback/particles/sound, and add subtle camera response. A pure allocation-free attack-pose helper is being added with tests for held impact and full recovery. The paired capture tests passed; there were no console errors or page overflow. The remaining visual flaws are not waved through as a functional test pass.
