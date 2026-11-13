# Shots

Phone portrait, app at 1080x2400 on the `probe` emulator; refs are the prototype phone at 390x760 css px (780x1520). Side-by-side cells are letterboxed to 9:19.

| Shot | Ref | State | How to reach it on the emulator | Take from the reference |
|---|---|---|---|---|
| S01 | R01 | Mini player at rest over Stream, a song loaded | `lyricflow://open/stream`, play a song, settle | Compact pill with cover, title/artist, controls; calm page behind; bar visible |
| S02 | R02 | Open ~35%, finger holding | swipe up from the mini player and hold (adb `input motionevent DOWN/MOVE`, screencap before UP) | One continuous surface rising from the pill's edge; artwork already larger and moving toward its final spot; page dims slightly; mini contents gone |
| S03 | R03 | Open ~70%, finger holding | same, further | Artwork near full size; title, scrubber and transport fading/sliding in under it; nav bar sliding out |
| S04 | R04 | Fully open | tap the mini player, settle | Big artwork top, title/artist, scrubber with times, transport; warm wash from the cover; no leftover pill |
| S05 | — (R05 after approval) | Create sheet open while a song plays | tap Create in the bar | Full-width sheet above the bar, rounded top corners, page dimmed, mini player hidden, Create turned into close, Allegra's actions inside |
