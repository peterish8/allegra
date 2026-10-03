# Handoff — 2026-10-03: letter-synced lyrics (done) + phone UI list (not started)

## Done in this commit

**Letter-by-letter lyrics, Echo Music style, on the phone and the website.**
Echo Music's renderer lives at `C:\Users\nithy\Desktop\aclones\Echo music\app\src\main\kotlin\com\music\echo\ui\component\EchoMusicLyrics.kt` (default style)
and `Lyrics.kt` (scroll: `performSmoothPageScroll`, line lead in `lyrics/LyricsUtils.kt findCurrentLineIndex`, +300 ms).

- `packages/shared/wordSync.ts` (+ test) — the one parser for both apps. Word timings travel as enhanced LRC
  (`[00:12.30]<00:12.300>Hel<00:12.520>lo <00:12.900>world<00:13.400>`), become `LyricLine.words`
  (`{ text, start, end }`, seconds, text keeps its trailing space). `displayWords` groups syllables into
  whole words; lines with no word timings get estimated ones (`estimateWords`); `sweepAt` = how lit a word is.
  The API gets a generated copy: `npm run sync:shared` → `apps/api/src/shared/wordSync.ts` (never edit that copy).
- Contract: `docs/api-contract.md` — `LyricLine.words?` is optional and additive; translated lines drop it.

**Phone (`apps/mobile`)**
- Providers keep timings: `services/lyrics/lrc.ts` (`ttmlToLrc` keeps spans, `toTimedLrc`), `providers.ts`
  (YouLyPlus syllabus → word tags, Paxsenix `content` with `part`), `LyricaService.parseLrc` fills `words`.
- SQLite: `lyrics.words` column (JSON), migration in `database/db.ts`, read/write in `database/queries.ts`.
- Setting: `settingsStore.lyricsHighlight: 'letters' | 'lines'` (default letters), Settings → Lyrics → Highlight.
- Renderer `components/SynchronizedLyrics.tsx`: `SweepRow`/`SweepWord` (clip + bright copy, two transforms, UI
  thread, only on active ±1 lines), Echo's graded opacity (`playback/lyricMotion.ts lineRestOpacity`), 0.3 s line
  lead (`LINE_LEAD_S`), and the glide is now a velocity-keeping critically damped follow (`glideStep`, frame
  callback that stops itself) instead of a restarting 520 ms timing curve.
- The lyrics editor still works in lines: saving there drops word timings (by design for now).

**Website (`apps/web` + `apps/api`)**
- API: `lib/lrc.ts parseLyrics` reads word tags (never as extra lines), `providers/betterlyrics.ts` and
  `providers/youlyplus.ts` keep syllable timing, `services/translation.ts` drops words on translated lines.
- Web: `lib/settings.ts lyricsHighlight` + Settings → Lyrics → Highlight; `lib/lyricFlow.ts` (+ test): frame
  clock between `timeupdate`s, follow step, `lineAt`. `components/LyricsPanel.tsx`: `tick()` rAF loop while
  `playing` sets the active line (with lead) and writes each word's `--p`; `SweepWords`; scroll uses the follow.
  CSS `.lyric-word*` in `styles/components.css`. The old unused `karaokeProgress`/`KaraokeLine` path is gone.
- `App.tsx` passes `playing={playerIsPlaying}` to both LyricsPanels.

### Not yet verified (do this first)
- Phone: build an APK and watch a word-synced song (YouLyPlus/BetterLyrics) and a line-only one (LRCLIB).
  Check wrapped lines line up under the sweep, RTL (Arabic/Urdu), CJK, and Settings → Highlight → Line by line.
- Web: open http://localhost:5173, play a song, open lyrics; check the sweep, the glide, Highlight toggle,
  translate on/off, and the phone width (360) layout.
- Existing cached lyrics on the phone have no `words` until re-fetched (line-only lyrics still sweep on estimates).

## Not started — the owner's next list (phone app, `apps/mobile`)

1. **Swipe down to close Now Playing: the bottom nav bar hides and pops back in** (glitch). Look at the
   sheet close path in `screens/NowPlayingScreen.tsx` / `MiniPlayer.tsx` / `PillPlayer` hand-over and how the
   tab bar's visibility follows `playerSheetProgress`; it should track the drag continuously, not toggle.
2. **Shader wash (`playerBackground: 'aura'`, `components/player/AuraBackdrop.tsx`) looks bad.** Make it blend
   with the cover art itself — colours from the artwork (`useArtworkPalette`), no flat colour wash; good on the
   player's sides.
3. **App background (Settings → Player → App background): only `glow` takes effect** — `shader` and `glass`
   don't. Check `DynamicAura` / `allegra/GlassRoom` / `GlowRoom` wiring and that every screen reads the setting.
4. **Luvs: the song title overlay hides the cover art** (`screens/LuvsScreen.tsx`, `components/luvs/`). Fix on
   all screen sizes.
5. **Luvs recommendations must follow the listener's taste** (`services/luvsTaste.ts`, `luvsLanes.ts`,
   `luvsEngine`, `stream/recommend.ts` — YouTube Music radio via `services/ytmusic/`), and show correct songs.
6. **Stream screen is cluttered** (`screens/StreamScreen.tsx`, `components/stream/StreamHome.tsx`): neat,
   simple, sweet.
7. **Library screen redesign** (`screens/LibraryScreen.tsx`, `components/library/`): clean and creative.
8. **Sleep timer UI** (`store/sleepTimerStore`, the `PlayerSheet` timer sheet): enhance.
9. **Up next panel** (`components/player/UpNextPanel.tsx`): frosted glass (`allegra/Frosted`), clean rows.
10. **Navigation speed**: page transitions fast, snappy, smooth (native Kotlin where it helps).

Rules that apply (from `apps/mobile/CLAUDE.md`): transform/opacity only, tokens from `constants/allegraTheme`,
`Frosted` for floating glass, no live blur on always-visible chrome, sentence case, nothing ticks when nothing
watches, Reduce Motion collapses to opacity.
