# Pocket Pal mobile check

Emulator tests can verify layout and event handling, but they cannot judge the comfort of Pip's care controls in a real hand. Open the live site on a phone and check these items:

## Phase 4 dungeon checks

- [ ] Hatch Pip and open Dungeon. Confirm an egg cannot start a run; after hatching, select up to three different run-only consumables and start.
- [ ] Confirm each regular floor offers three distinct room paths and three rooms before the floor stop. Floor 5 can offer an elite; every tenth floor is one boss room, and the biome changes every ten floors.
- [ ] Choose a fight and each tactic in turn. Confirm combat advances automatically, gauges track speed, health bars update, status effects appear in the log, and the boss switches skill at half health.
- [ ] Lower hunger or energy below 30%, then to zero, and confirm attack/speed penalties. Check each completed room costs one hunger and each fight costs two energy.
- [ ] Try healing, cleansing burn/stun, and a short buff from the pack both during and between fights. A full-health heal or unnecessary cleanse should not consume the item.
- [ ] Use an event choice that grants a boon or curse; confirm it stays in run state and does not modify permanent pet stats or another run.
- [ ] Visit a shop with enough run coins, buy an item, and leave the shop without buying; confirm the three-slot pack limit and run-only spending.
- [ ] Open treasure and confirm coin and token rewards stay in the run until a safe exit.
- [ ] At a floor stop, descend and then try leaving on a later floor. Confirm a safe exit banks all run coins and token value and shows the run summary.
- [ ] In a QA save, faint at zero HP. Confirm only half the coins and a deterministic random half of tokens are kept, the pack is lost, energy returns at zero, and the summary names the penalty.
- [ ] Confirm this pet's deepest floor appears in the current run and is saved to Hall of Pets after the generation ends; the all-time record should never go down.
- [ ] Save or reload mid-run. Confirm the app reopens paused and restores the floor, room, HP, wallet, pack, enemy and combat log without advancing while away.
- [ ] In Document Picture-in-Picture, confirm the current floor, room, HP bar and quick care actions remain visible while the main tab is hidden; if using video PiP, confirm its compact floor/room/HP overlay is readable. Closing PiP should return to normal pause rules.

## Care and mobile checks

- [ ] At 320px and 360px wide, scroll to Little ways to help; the care dock should stick to the bottom and its food and care buttons should be easy to tap without clipping or touching a neighbor.
- [ ] Try each snack, Play, Tuck in/Wake up, and Clean; each press should act once, with no repeat while held.
- [ ] Try holding two different care buttons briefly; their pressed feedback should remain independent and clear on release.
- [ ] Turn on Haptics in Settings; touch a care button and confirm one short tick. Turn it off and confirm the phone stays quiet.
- [ ] Use Settings to choose small/medium/large controls, adjust opacity, and switch Left-handed layout; close and reopen the page to confirm the choices stay saved.
- [ ] Confirm Sound and CRT toggles still work in Settings.
- [ ] Check the growth panel shows Level, XP progress, five stats, and a short care-tendency summary without pushing the care dock off-screen.
- [ ] Open Forms and confirm the Form Dex shows 20 slots, hides names for undiscovered forms, and updates its count after a form is revealed; check the empty Hall of Pets message.
- [ ] After Pip hatches, open Training games and try Quick Spark, Echo Garden, and Beat Bubbles with each available stat choice; confirm score feedback, XP, the level-scaled training cap, and the short cooldown.
- [ ] Use a migrated or QA-accelerated save to inspect Egg → Baby → Teen → Adult → Elder transitions. Confirm each completed stage's care tendencies influence the form roll and reset for the next stage.
- [ ] If an Evolution Stone is available in the QA save, use it once, confirm it is consumed, and verify the newly revealed form appears in the Dex.
- [ ] In an Elder QA save, confirm stats decline gradually with active time, then the next generation starts as an Egg with one inherited non-drawback trait, a small stat legacy bonus, and the previous pet listed in Hall of Pets.
- [ ] Scroll the care page normally, including when the on-screen keyboard is not in use; pinching the page to zoom should remain available for accessibility.
- [ ] In landscape, check the habitat and care choices remain reachable, then hide/show the browser and confirm the pause overlay prevents time-away decay.
- [ ] In a browser that offers Mini, open it while the game is running, switch away from the tab, and confirm Pip's needs continue changing in the mini window.
- [ ] Use Snack, Play, Rest/Wake, and Clean in Document Picture-in-Picture; close the mini window and confirm the main game is paused when you return.
- [ ] If Document Picture-in-Picture is unavailable but video Picture-in-Picture is offered, confirm the video view opens and Feed/Play media-session actions work when the browser exposes them.
- [ ] In a browser with neither Picture-in-Picture API, confirm Mini is not shown and normal pause-on-hide behavior remains.
- [ ] If the browser offers installation, install the PWA, reopen it offline, and verify the same saved pet and settings are present.
