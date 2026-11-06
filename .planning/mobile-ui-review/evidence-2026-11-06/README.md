# Evidence, 2026-11-06 (V6 corrections, 1.37.1 → 1.38.0)

Emulator: AVD `probe`, Android 16 image, 720×1440 px at density 2 (360×720 dp), font scale 1.0. These are emulator captures,
not device evidence. Covers belong to the songs the emulator happened to play.

| File | What it shows |
| --- | --- |
| `owner/owner-v6-board-reference-library-search.png` | The owner's capture of the V6 design canvas (Library and Search boards): the look they want. |
| `emulator/1.37.1-stream-overlap-and-gap.png` | Published 1.37.1: "Jump back in" drawn over the mood chips, and a ~108 dp blank gap after a one-row grid (UI-01, UI-03). |
| `emulator/1.37.1-stream-after-scroll.png` | The same layout after scrolling down and back: FlashList did not re-measure. |
| `emulator/1.37.1-stream-ui-dump.xml` | uiautomator bounds for that screen (chips 104–152 dp, heading from 120 dp; shell 24 + 56 + 64 dp). |
| `emulator/1.38.0-stream.png` | 1.38.0: no overlap, header glow, typed tiles, slimmer shell (16 + 48 + 56 dp). The second download icon was later removed in 1.38.1; the owner now wants it back (Round 7 item 9). |
| `emulator/1.38.0-stream-scrolled-glow-gone.png` | The glow leaves with the scroll. |
| `emulator/1.38.0-stream-ui-dump.xml` | Bounds proving the 1.38.0 measurements. |
| `emulator/1.38.0-player-title-two-lines-into-cover.png` | 1.38.0 two-line title grew into the cover; fixed in 1.38.1 (one line that shrinks to fit). |
| `emulator/1.38.0-upnext-fixed.png` | Up next rows start below the segmented filter (UI-02 fixed). |
| `emulator/1.38.0-library-songs-glow.png` | Library Songs with the glow. The owner's later capture of **Playlists** showed the glow cut off by an opaque box (cause: `PlaylistsScreen.tsx:132`, `:221`); that capture was not saved to disk. |
| `canvas/*.jpg` | Browser captures of the V6 design canvas (https://claude.ai/artifact/UGiYJ1UaRjWA66qTFjsmHT): Stream board top and shell, Now playing / Up next boards, Round 5 overview. |
