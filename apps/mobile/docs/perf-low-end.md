# Low-end performance baseline

How to measure LuvLyrics on a slow phone (the Galaxy M31 is the reference) so a change can be judged by numbers,
not by feel. Item 1 of [`.planning/performance-kotlin/REMAINING-WORK.md`](../../../.planning/performance-kotlin/REMAINING-WORK.md).
Never claim a change is faster without a before and after run from here.

## What it measures

`scripts/perf/low-end-baseline.sh` drives the installed app over `adb` with `lyricflow://` links and touch input:

| Scenario | What happens | Recorded as |
|---|---|---|
| `library-scroll` | eight flings down and up the Library song list | frame stats |
| `stream-scroll` | six flings down and up the Stream home | frame stats |
| `player-open-close` | open Now Playing from the pill and close it, repeatedly | frame stats |
| `lyrics-on` | 20 s of a song with lyrics showing | frame stats |
| `library`, `search` | a tap on a song until audio starts (`PerfMarks` "playing" line) | tap-to-audible ms |

Frame stats come from `dumpsys gfxinfo` (reset before each scenario).

## Before you run it

1. **A release build of the commit you are measuring.** A debug build is far slower and measures nothing useful.
   Either install the `apk-latest` release, or build locally with `scripts/perf/build_android_perf.ps1` (it sets
   `NODE_ENV=production`; without it Expo's config step fails).
2. **One device** on `adb devices`: the M31, or an emulator with `EMULATE_M31=1` (sets 1080 × 2340 at 420 dpi so the
   app draws as many pixels as the M31). A real phone is the measurement; an emulator only compares commits.
3. **A 500-song library** named `perf_001` … `perf_500`, so Library has something to scroll:
   `scripts/perf/seed-library.sh <serial> <work-dir>` (needs `ffmpeg`; imports through Settings → Add songs from
   this phone).
4. **Quiet conditions:** the FPS readout (Settings → About) off, Battery Saver off, nothing else building on the
   computer, the phone cool, on the same Wi-Fi as the last run.

## Run it

```bash
cd apps/mobile
scripts/perf/low-end-baseline.sh <serial> <out-dir> <label> 3
```

`<label>` names the build (for example `1.34.1-before`); `3` runs every scenario three times. Run it once for the
build before your change and once after, into the same `<out-dir>`.

## Read the results

- `<out-dir>/summary.tsv`: one row per scenario per run with `frames`, `janky_pct`, `p50_ms`, `p90_ms`, `p99_ms`.
- `<out-dir>/tap-to-audible.tsv`: one row per tap with `ms`.
- `<out-dir>/<label>-r<run>-<scenario>.gfxinfo.txt`: the raw frame stats behind each row.

Compare the **median of the three runs** per scenario between the two labels. Janky % and p90 are what a listener
feels; p50 rarely moves. A difference smaller than the spread between runs of the same build is noise.

## Recording it

Commit the results to `.planning/performance-kotlin/evidence/<date>-<device>/` with the build (version and commit),
the device, its refresh rate, whether Battery Saver was on, the network, and anything unusual (it got warm, a run
was redone). Item 5 of the remaining-work list picks its target from these numbers.
