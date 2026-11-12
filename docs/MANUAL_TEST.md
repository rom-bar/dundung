# Pocket Pal mobile check

Emulator tests can verify layout and event handling, but they cannot judge the comfort of Pip's care controls in a real hand. Open the live site on a phone and check these items:

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
