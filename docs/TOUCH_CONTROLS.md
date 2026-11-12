# Pocket Pal touch controls

Pocket Pal uses one-shot care choices rather than directional movement. Food, Play, Sleep/Wake, and Clean therefore activate on `pointerdown`, provide a pressed state, support independent pointers, and clear held styling on pointer release, cancellation, blur, or a hidden page. They do not auto-repeat: a held feeding button must never feed several times by surprise, and the simulation already enforces an action cooldown.

The game has no board, but on portrait phones the care buttons become a sticky bottom dock once the care section is in view. This keeps actions within thumb reach without covering the habitat on the initial screen; the page still scrolls normally and pinch zoom remains available. The buttons have at least 60px height and stay inside narrow viewports. Button size, control opacity, and left-handed order are configurable in Settings. Sound, CRT, and optional short touch haptics are also persisted there.

Swipe/gesture mode is intentionally omitted. Care actions are labeled choices, not spatial moves; turning arbitrary swipes into a meal or sleep action would be easier to trigger accidentally and harder to discover. Keyboard shortcuts and the existing game loop are unchanged.

## Automated and visual checks

`npm run test:unit` verifies simulation and pointer-state logic. `npm run test:e2e` builds the production app and checks 320×568, 360×740, 390×844, 740×360 landscape, 768×1024 tablet, and 1280×800 desktop layouts. Checks cover horizontal overflow, care target size, pointerdown activation, multi-pointer release, settings persistence, left-hand mirroring, and desktop keyboard input.

Review screenshots are stored in [`docs/screenshots/`](screenshots/). A real-device checklist is in [`docs/MANUAL_TEST.md`](MANUAL_TEST.md); emulation cannot establish thumb comfort or the actual vibration feel.
