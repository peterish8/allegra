import { AlignLeft, Check, Ellipsis, Info, Languages, LoaderCircle, Mic, Minus, Moon, Plus, RefreshCw, SlidersHorizontal, WifiOff, X } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import {
  Fragment,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type MutableRefObject,
  type ReactNode
} from 'react';
import { createPortal } from 'react-dom';

import type { LyricLine, LyricsPayload } from '@shared/types';
import { displayWords, isRtlText, sweepAt, type DisplayWord } from '@shared/wordSync';
import { continuePlainLyrics, plainLyricsScroll, PLAIN_SCROLL_SETTLE_MS } from '@shared/plainLyrics';

import type { KaraokeStage } from '../hooks/useLiveKaraoke';
import { KaraokeProgress } from './KaraokeProgress';
import { IconButton, TactileButton } from './ui';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { useSettings } from '../hooks/useSettings';
import { followSettled, followStep, lineAt, LINE_LEAD_S, lyricClockAt } from '../lib/lyricFlow';
import { clampLyricsOffset, withLyricsOffset, type LyricsSize } from '../lib/settings';
import { usePlayhead, type Playhead } from '../lib/playhead';

interface LyricsPanelProps {
  readonly lines: LyricLine[];
  readonly type?: LyricsPayload['type'];
  readonly duration?: number;
  /** English under each line, by index (translation keeps line order). Null shows the original alone. */
  readonly translations?: readonly string[] | null;
  /** Seconds into the song; the panel subscribes, so its parent does not re-render on each report. */
  readonly playhead: Playhead;
  /** The song is playing: the lyric clock then runs a frame at a time between the player's time reports. */
  readonly playing?: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly onSeek: (timestamp: number) => void;
  /** When set, tapping a line seeks and requests playback. */
  readonly onActivateLine?: (timestamp: number) => void;
  readonly compact?: boolean;
  readonly artworkUrl?: string | null;
  readonly translating?: boolean;
  readonly translated?: boolean;
  readonly translateError?: string | null;
  readonly translateProvider?: string | null;
  readonly onToggleTranslate?: () => void;
  readonly hideBackdrop?: boolean;
  /** Soft-focus stage: active line stays near the optical center (default true). */
  readonly softFocus?: boolean;
  readonly karaokeActive?: boolean;
  readonly karaokeBusy?: boolean;
  /** 0–1 while preparing karaoke. */
  readonly karaokeAriaLabel?: string;
  readonly karaokeDisabled?: boolean;
  readonly karaokeError?: string | null;
  readonly karaokeStage?: KaraokeStage | null;
  /** Receives the press so the caller can tell a double tap from a single one. */
  readonly onToggleKaraoke?: (event: MouseEvent<HTMLElement>) => void;
  /** Opens the vocal / instrument mix. Shown beside Karaoke while it is on. */
  readonly onOpenKaraokeMix?: (event: MouseEvent<HTMLElement>) => void;
  /** The song these lines belong to, so a sync nudge can be remembered for it. */
  readonly songId?: string | null;
  /** The version currently on stage; provenance helps a listener decide whether to compare it. */
  readonly source?: string | null;
  readonly matchReason?: string | null;
  readonly alternatives?: readonly LyricsPayload[] | null;
  readonly alternativesLoading?: boolean;
  readonly alternativesError?: string | null;
  readonly onLoadAlternatives?: () => void;
  readonly onSelectAlternative?: (alternative: LyricsPayload) => void;
  readonly onSyncLyrics?: () => void;
  /** Where the wide player wants the ⋯ lyric actions: its top bar's right-hand slot. */
  readonly actionsSlot?: HTMLElement | null;
}

const FOLLOW_RESUME_MS = 2200;

/** Multiplies every lyric font-size rule (see `--lyrics-scale` in the stylesheets). */
const LYRICS_SCALE: Record<LyricsSize, number> = { small: 0.85, medium: 1, large: 1.2 };

/**
 * Synced lyrics that flow the way Echo Music moves them (the phone does the same).
 *
 * - A lyric clock runs a frame at a time between the player's time reports (lib/lyricFlow),
 *   and a line goes live `LINE_LEAD_S` before it is sung so the list is already moving.
 * - Letter by letter (Settings → Lyrics → Highlight, the default): each word of the sung
 *   line fills from its first letter to its last, by syllable when the lyrics are
 *   word-timed (`words` from YouLyPlus / BetterLyrics) and on estimated timings otherwise
 *   (packages/shared/wordSync). The fill is a clip sliding across a bright copy of the
 *   word — two transforms per word, written as `--p` straight to the DOM each frame.
 * - The list eases onto the sung line on a critically damped follow that keeps its speed
 *   when the next line arrives mid-glide (`scrollActiveIntoView`).
 * Soft-focus uses overflow scroll (not transform lock) so past/future lines stay reachable.
 */
export function LyricsPanel({
  lines,
  type = 'synced',
  duration = 0,
  translations = null,
  playhead,
  playing = false,
  loading,
  error,
  onRetry,
  onSeek,
  onActivateLine,
  compact = false,
  artworkUrl = null,
  translating = false,
  translated = false,
  translateError = null,
  translateProvider = null,
  onToggleTranslate,
  hideBackdrop = false,
  softFocus = true,
  karaokeActive = false,
  karaokeBusy = false,
  karaokeAriaLabel,
  karaokeDisabled = false,
  karaokeError = null,
  karaokeStage = null,
  onToggleKaraoke,
  onOpenKaraokeMix,
  songId = null,
  source = null,
  matchReason = null,
  alternatives = null,
  alternativesLoading = false,
  alternativesError = null,
  onLoadAlternatives,
  onSelectAlternative,
  onSyncLyrics,
  actionsSlot = null
}: LyricsPanelProps) {
  const plain = type === 'plain';
  const reduced = useReducedMotion();
  const lineRefs = useRef<Record<number, HTMLButtonElement | null>>({});
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const followPausedRef = useRef(false);
  const resumeTimerRef = useRef(0);
  /** rAF handle for our own scroll animation, so a new target can cancel the last one cleanly. */
  const scrollAnimationRef = useRef(0);
  /** Where the follow is heading, where it is (fractional px) and its speed — kept across line changes. */
  const followRef = useRef({ target: 0, position: 0, velocity: 0 });
  /** True while our own animation is moving the container — the scroll handler must ignore it. */
  const isAnimatingRef = useRef(false);
  const lastSongKeyRef = useRef('');
  /** False until the list has been positioned once, so opening mid-song lands on the line instead of gliding from the top. */
  const positionedRef = useRef(false);
  const [followPaused, setFollowPaused] = useState(false);
  const [plainPaused, setPlainPaused] = useState(false);
  const touchingRef = useRef(false);
  const plainAnchorRef = useRef<{ time: number; top: number } | null>(null);
  const plainNeedsAnchorRef = useRef(false);
  const [alternativesOpen, setAlternativesOpen] = useState(false);
  const alternativesCloseRef = useRef<HTMLButtonElement | null>(null);
  const [sourceInfoOpen, setSourceInfoOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    if (!alternativesOpen) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    alternativesCloseRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setAlternativesOpen(false);
    };
    // Capture before the player's Escape handler, so this closes the picker only.
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      document.removeEventListener('keydown', closeOnEscape, true);
      if (opener?.isConnected) opener.focus();
    };
  }, [alternativesOpen]);

  const currentTime = usePlayhead(playhead);
  const [settings, updateSettings] = useSettings();
  const rememberOffset = settings.rememberLyricsOffset && songId !== null;
  const savedOffset = rememberOffset ? (settings.lyricsOffsets[songId] ?? 0) : 0;

  /** Listener sync nudge in seconds: positive delays the lyrics, negative shows them earlier. */
  const [syncOffset, setSyncOffsetState] = useState(savedOffset);
  const syncedTime = plain ? currentTime : currentTime - syncOffset;
  const setSyncOffset = useCallback(
    (next: number) => {
      const resolved = clampLyricsOffset(next);
      setSyncOffsetState(resolved);
      if (rememberOffset && songId) {
        updateSettings((current) => ({ lyricsOffsets: withLyricsOffset(current.lyricsOffsets, songId, resolved) }));
      }
    },
    [rememberOffset, songId, updateSettings]
  );

  const letters = !plain && settings.lyricsHighlight === 'letters';
  const timestamps = useMemo(() => lines.map((line) => line.timestamp), [lines]);
  /** Each line as words that know when they are sung, while lines light letter by letter. */
  const sweeps = useMemo(
    () => lines.map((line, index) => (letters && !isInstrumental(line.text) ? displayWords(line, lines[index + 1]?.timestamp, true) : null)),
    [lines, letters]
  );

  // The lyric clock: re-anchored on every time report, carried on a frame at a time while playing.
  const [activeIndex, setActiveIndex] = useState(() => lineAt(timestamps, syncedTime + LINE_LEAD_S));
  const activeRef = useRef(activeIndex);
  const clockRef = useRef({ anchor: syncedTime, at: 0, value: syncedTime });
  useEffect(() => {
    clockRef.current = { anchor: syncedTime, at: performance.now(), value: clockRef.current.value };
  }, [syncedTime]);

  /** One frame: which line is live, and how far each of its words is lit (written straight to the DOM). */
  const tick = useCallback(
    (now: number) => {
      const clock = clockRef.current;
      const time = playing ? lyricClockAt(clock.anchor, clock.at, now, clock.value) : clock.anchor;
      clock.value = time;
      const live = plain ? -1 : lineAt(timestamps, time + LINE_LEAD_S);
      if (plain && settings.autoScrollPlainLyrics && !plainPaused && !followPausedRef.current) {
        const container = scrollRef.current;
        if (container) {
          isAnimatingRef.current = true;
          const anchor = plainAnchorRef.current;
          container.scrollTop = anchor
            ? continuePlainLyrics(time, duration, container.scrollHeight, container.clientHeight, anchor.time, anchor.top)
            : plainLyricsScroll(time, duration, container.scrollHeight, container.clientHeight);
        }
      }
      if (live !== activeRef.current) {
        activeRef.current = live;
        setActiveIndex(live);
      }
      const words = sweeps[live];
      if (!words) return;
      const fills = lineRefs.current[live]?.querySelectorAll<HTMLElement>('.lyric-word__fill');
      if (!fills) return;
      words.forEach((word, index) => {
        const fill = fills[index];
        if (!fill) return;
        const lit = sweepAt(time, word.segments, word.weight);
        const value = (reduced ? (lit > 0 ? 1 : 0) : lit).toFixed(4);
        if (fill.style.getPropertyValue('--p') !== value) fill.style.setProperty('--p', value);
        // A word not yet sung draws nothing: its bright copy waits beside it, and even faded its
        // halo would show at the word's edge.
        const visibility = lit > 0 ? '' : 'hidden';
        if (fill.style.visibility !== visibility) fill.style.visibility = visibility;
      });
    },
    [playing, timestamps, sweeps, reduced, plain, duration, settings.autoScrollPlainLyrics, plainPaused]
  );

  // Playing: every frame. Paused: once per change (a seek, a nudge, a new song).
  useEffect(() => {
    if (playing) return;
    tick(performance.now());
  }, [tick, playing, syncedTime]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const loop = (now: number): void => {
      tick(now);
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(frame);
  }, [tick, playing]);

  const nudgeSync = useCallback((delta: number) => setSyncOffset(syncOffset + delta), [setSyncOffset, syncOffset]);

  const songKey = useMemo(
    () => (lines.length > 0 ? `${songId}:${type}:${lines[0]?.text}:${lines.length}:${lines[lines.length - 1]?.text}` : ''),
    [lines, songId, type]
  );
  const hasTranslations = translations !== null;

  const anchorPlainFollow = useCallback(() => {
    const container = scrollRef.current;
    if (plain && plainNeedsAnchorRef.current && container) {
      plainAnchorRef.current = { time: playhead.get(), top: container.scrollTop };
      plainNeedsAnchorRef.current = false;
    }
  }, [plain, playhead]);

  const pauseFollow = useCallback(() => {
    if (plain) plainNeedsAnchorRef.current = true;
    if (scrollAnimationRef.current) {
      window.cancelAnimationFrame(scrollAnimationRef.current);
      scrollAnimationRef.current = 0;
    }
    isAnimatingRef.current = false;
    followPausedRef.current = true;
    setFollowPaused(true);
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = window.setTimeout(() => {
      if (touchingRef.current) return;
      anchorPlainFollow();
      followPausedRef.current = false;
      setFollowPaused(false);
    }, plain ? PLAIN_SCROLL_SETTLE_MS : FOLLOW_RESUME_MS);
  }, [plain, anchorPlainFollow]);

  // Release outside the list still ends a held mouse/pen gesture.
  useEffect(() => {
    const release = (event: PointerEvent): void => {
      if (!touchingRef.current || event.pointerType === 'touch') return;
      touchingRef.current = false;
      pauseFollow();
    };
    document.addEventListener('pointerup', release);
    return () => document.removeEventListener('pointerup', release);
  }, [pauseFollow]);

  const resumeFollowNow = useCallback(() => {
    anchorPlainFollow();
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    followPausedRef.current = false;
    setFollowPaused(false);
  }, [anchorPlainFollow]);

  useEffect(() => () => {
    if (resumeTimerRef.current) window.clearTimeout(resumeTimerRef.current);
    if (scrollAnimationRef.current) window.cancelAnimationFrame(scrollAnimationRef.current);
  }, []);

  // New lyric set (song change / reopen after load): reset scroll + follow.
  useLayoutEffect(() => {
    if (!songKey || songKey === lastSongKeyRef.current) return;
    lastSongKeyRef.current = songKey;
    // A remembered nudge for this song comes back; otherwise timing starts true.
    setSyncOffsetState(savedOffset);
    setPlainPaused(false);
    plainAnchorRef.current = null;
    plainNeedsAnchorRef.current = false;
    positionedRef.current = false;
    resumeFollowNow();
    if (scrollAnimationRef.current) window.cancelAnimationFrame(scrollAnimationRef.current);
    isAnimatingRef.current = false;
    const container = scrollRef.current;
    if (container) container.scrollTop = 0;
    // Only a new lyric set re-reads the saved offset (so it is not a dependency); the nudge keeps it current.
  }, [songKey, resumeFollowNow]);

  // Lead space above the first line equals the anchor height, so line one can rise to the same focus
  // point as every other line instead of sitting in the top fade. Tracks the real box, not viewport units.
  const hasScroll = !loading && !error && lines.length > 0;
  useLayoutEffect(() => {
    const container = scrollRef.current;
    if (!hasScroll || !container) return;
    const setLead = (): void => {
      container.style.setProperty('--lyrics-lead', `${Math.round(container.clientHeight * ACTIVE_LINE_ANCHOR)}px`);
      const panel = container.closest<HTMLElement>('.ytm-lyrics');
      if (!panel) return;
      const box = container.getBoundingClientRect();
      const parent = panel.getBoundingClientRect();
      panel.style.setProperty('--lyrics-scroll-top', `${box.top - parent.top}px`);
      panel.style.setProperty('--lyrics-scroll-bottom', `${parent.bottom - box.bottom}px`);
      panel.style.setProperty('--lyrics-scroll-height', `${box.height}px`);
    };
    setLead();
    const observer = new ResizeObserver(setLead);
    observer.observe(container);
    return () => observer.disconnect();
  }, [hasScroll]);

  const scrollActiveIntoView = useCallback(
    (instant: boolean) => {
      const container = scrollRef.current;
      const active = lineRefs.current[activeIndex];
      if (!container || !active) return;

      // A touch above centre — the sung line is the focal point, with more of what is coming below it.
      // Measured against the container's own box: offsetTop is relative to the nearest
      // positioned ancestor, which is the section, so it silently adds the chrome height
      // and parks the active line above centre.
      const offsetInScroll =
        container.scrollTop + (active.getBoundingClientRect().top - container.getBoundingClientRect().top);
      // A line that wraps to several rows would push its top up into the stage's top fog, which
      // blurs the words being sung; past that height the line rests just clear of the fog instead.
      const restingTop = Math.max(
        container.clientHeight * ACTIVE_LINE_ANCHOR - active.offsetHeight / 2,
        container.clientHeight * FOG_CLEARANCE
      );
      const target = offsetInScroll - restingTop;
      const nextTop = Math.max(0, target);
      const start = container.scrollTop;
      const distance = nextTop - start;
      if (Math.abs(distance) < 2) return;

      const follow = followRef.current;
      if (instant) {
        if (scrollAnimationRef.current) window.cancelAnimationFrame(scrollAnimationRef.current);
        scrollAnimationRef.current = 0;
        isAnimatingRef.current = false;
        follow.velocity = 0;
        container.scrollTop = nextTop;
        return;
      }

      // Driven by rAF, not the browser's native smooth scroll (whose easing varies by engine
      // and lagged the highlight). A critically damped follow: a new line mid-glide only moves
      // the target and the list keeps the speed it had, so the lines flow instead of restarting.
      follow.target = nextTop;
      if (scrollAnimationRef.current) return;
      follow.position = start;
      follow.velocity = 0;
      isAnimatingRef.current = true;
      let last = performance.now();

      const step = (now: number): void => {
        const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now;
        const state = followStep(follow.position - follow.target, follow.velocity, dt);
        follow.velocity = state.velocity;
        if (followSettled(state)) {
          follow.position = follow.target;
          container.scrollTop = follow.target;
          isAnimatingRef.current = false;
          scrollAnimationRef.current = 0;
          return;
        }
        follow.position = follow.target + state.offset;
        container.scrollTop = follow.position;
        scrollAnimationRef.current = window.requestAnimationFrame(step);
      };
      scrollAnimationRef.current = window.requestAnimationFrame(step);
    },
    [activeIndex]
  );

  // Auto-follow active line unless the user is freely scrolling.
  useLayoutEffect(() => {
    if (plain) return;
    if (followPausedRef.current) return;
    if (loading || lines.length === 0) return;
    const firstPlacement = !positionedRef.current;
    positionedRef.current = true;
    scrollActiveIntoView(Boolean(reduced) || firstPlacement);
    // Showing or hiding translations changes every line's height, so the active line is placed again.
  }, [activeIndex, loading, lines.length, reduced, scrollActiveIntoView, followPaused, songKey, hasTranslations, plain]);

  // Seeks and re-enabling follow place plain text proportionally, including while paused.
  const lastPlainTime = useRef(currentTime);
  useLayoutEffect(() => {
    const seek = Math.abs(currentTime - lastPlainTime.current) > 1;
    lastPlainTime.current = currentTime;
    if (!plain || (!seek && (followPaused || plainPaused || !settings.autoScrollPlainLyrics))) return;
    const container = scrollRef.current;
    if (!container) return;
    if (seek) {
      plainAnchorRef.current = null;
      plainNeedsAnchorRef.current = false;
    }
    isAnimatingRef.current = true;
    const anchor = plainAnchorRef.current;
    container.scrollTop = anchor
      ? continuePlainLyrics(currentTime, duration, container.scrollHeight, container.clientHeight, anchor.time, anchor.top)
      : plainLyricsScroll(currentTime, duration, container.scrollHeight, container.clientHeight);
  }, [plain, currentTime, duration, followPaused, plainPaused, settings.autoScrollPlainLyrics, lines, hasTranslations]);

  const handleScroll = useCallback(() => {
    // Our own animation drives scrollTop every frame too, so ignore scroll events while it runs.
    if (isAnimatingRef.current) return;
    pauseFollow();
  }, [pauseFollow]);

  const handleLineActivate = useCallback(
    (timestamp: number) => {
      resumeFollowNow();
      // The line is highlighted at timestamp + offset, so seek there to land on it.
      const target = Math.max(0, timestamp + syncOffset);
      if (onActivateLine) onActivateLine(target);
      else onSeek(target);
      // Snap after seek so the tapped line is centered immediately.
      window.requestAnimationFrame(() => {
        scrollActiveIntoView(Boolean(reduced));
      });
    },
    [onActivateLine, onSeek, reduced, resumeFollowNow, scrollActiveIntoView, syncOffset]
  );

  // Source and match reason live behind an info button by the timing pill, not above the words.
  const showSourceInfo = settings.showLyricsSource && Boolean(source || matchReason);

  const toggleAlternatives = (): void => {
    // Load outside the updater: updaters run during render, and the loader sets parent state.
    if (!alternativesOpen && alternatives === null && !alternativesLoading) onLoadAlternatives?.();
    setAlternativesOpen(!alternativesOpen);
  };

  const karaokeLabel = karaokeActive ? 'Karaoke on' : 'Karaoke';
  const showMix = Boolean(onOpenKaraokeMix) && (karaokeActive || karaokeBusy);
  const showTranslate = Boolean(onToggleTranslate) && lines.length > 0;

  // One dock popover at a time; a tap anywhere outside the dock closes it.
  const dockRef = useRef<HTMLDivElement | null>(null);
  const dockPopoverOpen = sourceInfoOpen || moreOpen;
  useEffect(() => {
    if (!dockPopoverOpen) return;
    const close = (event: PointerEvent): void => {
      if (dockRef.current?.contains(event.target as Node)) return;
      setSourceInfoOpen(false);
      setMoreOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [dockPopoverOpen]);

  // Wide player: the header's actions fold into a ⋯ that opens into a pill, so nothing sits
  // above the words until asked for. The phone uses the dock menu instead; teasers keep the row.
  const isNarrow = useNarrowViewport();
  const collapsibleActions = hideBackdrop && !compact && !isNarrow;
  const actionsRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    if (!actionsOpen) return;
    const top = actionsSlot?.closest<HTMLElement>('.listening-top');
    const tabs = top?.querySelector<HTMLElement>('.player-tabs');
    const back = top?.querySelector<HTMLElement>('.listening-collapse');
    const pill = actionsRef.current?.querySelector<HTMLElement>('.ytm-lyrics__chrome-actions');
    const makeRoom = (): void => {
      if (!actionsSlot || !top || !tabs || !back || !pill) return;
      // Measure the resting position even during an interrupted slide.
      const offset = new DOMMatrixReadOnly(getComputedStyle(tabs).transform).m41;
      const box = tabs.getBoundingClientRect();
      const pillLeft = actionsSlot.getBoundingClientRect().right - pill.offsetWidth;
      const room = Math.max(0, box.left - offset - back.getBoundingClientRect().right - 12);
      const shift = Math.min(room, Math.max(0, box.right - offset - pillLeft + 12));
      top.style.setProperty('--tabs-shift', `${-shift}px`);
    };
    makeRoom();
    const observer = new ResizeObserver(makeRoom);
    for (const element of [top, tabs, back, pill]) if (element) observer.observe(element);
    window.addEventListener('resize', makeRoom);
    const closeOutside = (event: PointerEvent): void => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setActionsOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', makeRoom);
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
      top?.style.removeProperty('--tabs-shift');
    };
  }, [actionsOpen, actionsSlot]);

  const toggleBlackBackground = (): void => {
    updateSettings({ playerBlackBackground: !settings.playerBlackBackground });
  };
  /** Letter by letter ↔ line by line (also a triple tap on the player's Lyrics tab). */
  const toggleLineByLine = (): void => {
    updateSettings({ lyricsHighlight: letters ? 'lines' : 'letters' });
  };

  const runFromMenu = (event: MouseEvent<HTMLElement>, action?: (event: MouseEvent<HTMLElement>) => void): void => {
    setMoreOpen(false);
    action?.(event);
  };

  // Rendered in the player's top bar (top-right corner) when it hands us a slot, else in place.
  const karaokeButton = onToggleKaraoke ? (
    <TactileButton
      variant={karaokeActive ? 'primary' : 'ghost'}
      icon={Mic}
      onClick={onToggleKaraoke}
      disabled={karaokeDisabled}
      aria-pressed={karaokeActive}
      aria-busy={karaokeBusy || undefined}
      aria-label={karaokeAriaLabel ?? (karaokeActive ? 'Turn karaoke off' : 'Turn karaoke on')}
      className={`ytm-lyrics__karaoke-btn${karaokeActive ? ' is-on' : ''}${karaokeBusy ? ' is-busy' : ''}`}
    >
      {karaokeLabel}
    </TactileButton>
  ) : null;

  const actionsNode = (
    <div
      ref={actionsRef}
      className={`ytm-lyrics__actions${collapsibleActions ? ' is-collapsible' : ''}${actionsOpen ? ' is-open' : ''}`}
    >
      {collapsibleActions && !actionsOpen && karaokeButton ? (
        <div className="ytm-lyrics__karaoke-pin">{karaokeButton}</div>
      ) : null}
      <div id="lyrics-actions" className="ytm-lyrics__chrome-actions" inert={collapsibleActions && !actionsOpen}>
        {(!collapsibleActions || actionsOpen) ? karaokeButton : null}
        {showMix ? (
          <IconButton
            icon={SlidersHorizontal}
            label="Karaoke mix: vocals and instruments"
            aria-haspopup="dialog"
            className="ytm-lyrics__mix-btn"
            onClick={onOpenKaraokeMix}
          />
        ) : null}
        {showTranslate ? (
          <TactileButton
            variant="ghost"
            icon={translating ? LoaderCircle : Languages}
            onClick={onToggleTranslate}
            aria-label={translated ? 'Show original lyrics' : 'Translate lyrics to English'}
            className="ytm-lyrics__translate-button"
          >
            {translating ? 'Translating…' : translated ? 'Original' : 'Translate'}
          </TactileButton>
        ) : null}
        {onLoadAlternatives ? (
          <TactileButton
            variant={alternativesOpen ? 'secondary' : 'ghost'}
            icon={RefreshCw}
            onClick={toggleAlternatives}
            aria-expanded={alternativesOpen}
            aria-controls="lyrics-alternatives"
            className="ytm-lyrics__alternatives-button"
          >
            Other lyrics
          </TactileButton>
        ) : null}
        {!compact ? (
          <TactileButton
            variant={letters ? 'ghost' : 'secondary'}
            icon={AlignLeft}
            onClick={toggleLineByLine}
            aria-pressed={!letters}
            aria-label="Line by line: light the whole line at once instead of letter by letter"
            title="Line by line (or triple-tap the Lyrics tab)"
            className="ytm-lyrics__lines-button"
          >
            Line by line
          </TactileButton>
        ) : null}
        {hideBackdrop && !compact ? (
          <TactileButton
            variant={settings.playerBlackBackground ? 'secondary' : 'ghost'}
            icon={Moon}
            onClick={toggleBlackBackground}
            aria-pressed={settings.playerBlackBackground}
            aria-label="Black background"
            className="ytm-lyrics__black-button"
          >
            Black
          </TactileButton>
        ) : null}
        {collapsibleActions ? (
          <button
            type="button"
            className="ytm-lyrics__actions-close"
            onClick={() => setActionsOpen(false)}
            aria-label="Close lyrics options"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {collapsibleActions ? (
        <button
          type="button"
          className="ytm-lyrics__actions-toggle"
          onClick={() => setActionsOpen(true)}
          aria-expanded={actionsOpen}
          aria-controls="lyrics-actions"
          aria-label="Lyrics options"
          title="Lyrics options"
          inert={actionsOpen}
        >
          <Ellipsis size={18} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );

  return (
    <section
      className={`ytm-lyrics ${compact ? 'ytm-lyrics--compact' : ''} ${hideBackdrop ? 'ytm-lyrics--nobackdrop' : ''} ${softFocus && !compact ? 'ytm-lyrics--softfocus' : ''}${followPaused ? ' is-user-scrolling' : ''}`}
      aria-labelledby="lyrics-heading"
      style={{ '--lyrics-scale': LYRICS_SCALE[settings.lyricsSize] } as CSSProperties}
    >
      {!hideBackdrop && (
        <>
          {artworkUrl ? (
            <div
              className="ytm-lyrics__backdrop"
              style={{ backgroundImage: `url(${JSON.stringify(artworkUrl)})` }}
              aria-hidden="true"
            />
          ) : (
            <div className="ytm-lyrics__backdrop ytm-lyrics__backdrop--empty" aria-hidden="true" />
          )}
          <div className="ytm-lyrics__veil" aria-hidden="true" />
        </>
      )}

      <div className="ytm-lyrics__chrome">
        {onSyncLyrics && (plain || lines.length === 0) ? <TactileButton variant="ghost" onClick={onSyncLyrics}>Sync lyrics</TactileButton> : null}
        <div className="ytm-lyrics__heading">
          <h2 id="lyrics-heading">Lyrics</h2>
          <span className="ytm-lyrics__hint">{lines.length > 0 ? 'Tap any line to jump audio' : 'Waiting for track'}</span>
        </div>
        {collapsibleActions && actionsSlot ? createPortal(actionsNode, actionsSlot) : actionsNode}
      </div>
      {karaokeActive && karaokeBusy ? <KaraokeProgress stage={karaokeStage} variant="lyrics" /> : null}
      {alternativesOpen ? (
        <div id="lyrics-alternatives" className="lyrics-alternatives" aria-live="polite">
          <div className="lyrics-alternatives__head">
            <div className="lyrics-alternatives__intro">
              <strong>
                Lyric versions
                {alternatives && alternatives.length > 0 ? <span className="lyrics-alternatives__count">{alternatives.length}</span> : null}
              </strong>
              <span>Wrong words or timing? Pick another match for this song.</span>
            </div>
            <button ref={alternativesCloseRef} type="button" className="lyrics-alternatives__close" onClick={() => setAlternativesOpen(false)} aria-label="Close lyric versions">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {alternativesLoading ? (
            <div className="lyrics-alternatives__list" role="status" aria-label="Looking for other versions">
              {[0, 1, 2].map((item) => (
                <div key={item} className="lyrics-alternative lyrics-alternative--skeleton" aria-hidden="true">
                  <i />
                  <i />
                </div>
              ))}
            </div>
          ) : alternativesError ? (
            <div className="lyrics-alternatives__empty" role="alert">
              <p>{alternativesError}</p>
              {onLoadAlternatives ? (
                <button type="button" className="lyrics-alternatives__retry" onClick={onLoadAlternatives}>
                  <RefreshCw size={14} aria-hidden="true" /> Try again
                </button>
              ) : null}
            </div>
          ) : alternatives?.length === 0 ? (
            <div className="lyrics-alternatives__empty">
              <p>{lines.length > 0 ? 'No other version found. These lyrics are the only match for this recording.' : 'No lyric version found for this recording. Try searching again later.'}</p>
            </div>
          ) : alternatives ? (
            <div className="lyrics-alternatives__list" role="group" aria-label="Other lyric versions">
              {alternatives.map((alternative, index) => {
                const selected = alternative.source === source && alternative.lines.length === lines.length && alternative.lines[0]?.text === lines[0]?.text;
                const preview = alternativePreview(alternative);
                return (
                  <button
                    key={`${alternative.source}-${alternative.lines[0]?.timestamp ?? index}-${index}`}
                    type="button"
                    className={`lyrics-alternative${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    onClick={() => {
                      onSelectAlternative?.(alternative);
                      setAlternativesOpen(false);
                    }}
                  >
                    <span className="lyrics-alternative__top">
                      <strong>{formatSource(alternative.source)}</strong>
                      <span className={`lyrics-alternative__type is-${alternative.type}`}>{alternative.type === 'synced' ? 'Synced' : 'Plain'}</span>
                      {selected ? (
                        <span className="lyrics-alternative__current">
                          <Check size={12} aria-hidden="true" /> Showing
                        </span>
                      ) : null}
                    </span>
                    {preview ? <span className="lyrics-alternative__preview">{preview}</span> : null}
                    <small>{alternativeMeta(alternative)}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
          {onSyncLyrics ? <button type="button" className="lyrics-alternatives__retry" onClick={() => { setAlternativesOpen(false); onSyncLyrics(); }}>Sync lyrics</button> : null}
        </div>
      ) : null}
      {karaokeError ? (
        <p className="ytm-lyrics__alert" role="alert">
          {karaokeError}
        </p>
      ) : null}

      {translateError ? <p className="ytm-lyrics__alert" role="alert">{translateError}</p> : null}
      {translated && translateProvider ? (
        <p className="ytm-lyrics__note">Translated by {translateProvider} — meaning, not word-for-word.</p>
      ) : null}

      {softFocus && !plain && !compact && !loading && !error && lines.length > 0 ? (
        <>
          <div className="ytm-lyrics__edge ytm-lyrics__edge--top" aria-hidden="true"><i /><i /><i /><i /><i /></div>
          <div className="ytm-lyrics__edge ytm-lyrics__edge--bottom" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        </>
      ) : null}

      {loading ? (
        <div className="ytm-lyrics__state ytm-lyrics__state--loading" role="status" aria-live="polite">
          <div className="lyrics-fetch">
            <span className="lyric-wave lyric-wave--live" aria-hidden="true"><i /><i /><i /><i /><i /></span>
            <p>Fetching lyrics</p>
          </div>
        </div>
      ) : error ? (
        <div className="ytm-lyrics__state ytm-lyrics__state--error">
          <LyricsMessage tone="error" title="Lyrics didn't load" copy={error}>
            <TactileButton icon={RefreshCw} onClick={onRetry}>Try again</TactileButton>
          </LyricsMessage>
        </div>
      ) : lines.length === 0 ? (
        <div className="ytm-lyrics__state ytm-lyrics__state--empty">
          <LyricsMessage
            tone="empty"
            title="No lyrics for this one"
            copy={compact ? 'Just the music this time.' : 'Just the music this time. Sit back and enjoy it, or check whether another version has the words.'}
          >
            {!compact && onLoadAlternatives ? (
              <TactileButton
                icon={RefreshCw}
                onClick={() => {
                  if (!alternativesOpen) toggleAlternatives();
                }}
              >
                Find another version
              </TactileButton>
            ) : null}
            {!compact ? (
              <TactileButton variant="ghost" onClick={onRetry}>
                Search again
              </TactileButton>
            ) : null}
          </LyricsMessage>
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={`ytm-lyrics__scroll${softFocus && !compact ? ' ytm-lyrics__scroll--soft' : ''}${plain ? ' is-plain' : ''}`}
          role="group"
          aria-label="Song lyrics"
          onScroll={handleScroll}
          onScrollEnd={() => {
            if (plain && followPausedRef.current && !touchingRef.current) resumeFollowNow();
          }}
          onWheel={pauseFollow}
          onPointerDown={() => { touchingRef.current = true; pauseFollow(); }}
          onPointerUp={() => { touchingRef.current = false; if (plain) resumeFollowNow(); else pauseFollow(); }}
          onPointerCancel={(event) => { if (event.pointerType !== 'touch') touchingRef.current = false; pauseFollow(); }}
          onTouchStart={() => { touchingRef.current = true; pauseFollow(); }}
          onTouchEnd={() => { touchingRef.current = false; pauseFollow(); }}
          onTouchCancel={() => { touchingRef.current = false; pauseFollow(); }}
          onKeyDown={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) pauseFollow(); }}
          tabIndex={0}
        >
          {lines.map((line, index) => (
            plain ? <p key={`${line.lineOrder}-${index}`} className="ytm-lyrics__line is-plain">
              {line.text}
              {translationFor(line, translations?.[index]) ? <span className="ytm-lyrics__translation" lang="en">{translationFor(line, translations?.[index])}</span> : null}
            </p> :
            <LyricLineButton
              key={`${line.lineOrder}-${line.timestamp}`}
              line={line}
              translation={translationFor(line, translations?.[index])}
              index={index}
              activeIndex={activeIndex}
              sweep={sweeps[index] ?? null}
              onActivate={handleLineActivate}
              lineRefs={lineRefs}
            />
          ))}
        </div>
      )}

      {lines.length > 0 && !loading && !error && !compact ? (
        <div className="lyrics-dock" ref={dockRef}>
          {/* Phone only (CSS): the header's lyric actions collapse into this menu. */}
          {moreOpen ? (
            <div id="lyrics-more-menu" className="lyrics-dock__menu" role="group" aria-label="Lyrics options">
              {onToggleKaraoke ? (
                <button
                  type="button"
                  className={`lyrics-dock__item${karaokeActive ? ' is-on' : ''}`}
                  onClick={(event) => runFromMenu(event, onToggleKaraoke)}
                  disabled={karaokeDisabled}
                  aria-pressed={karaokeActive}
                  aria-busy={karaokeBusy || undefined}
                >
                  <Mic size={16} aria-hidden="true" />
                  {karaokeLabel}
                </button>
              ) : null}
              {showMix ? (
                <button type="button" className="lyrics-dock__item" onClick={(event) => runFromMenu(event, onOpenKaraokeMix)} aria-haspopup="dialog">
                  <SlidersHorizontal size={16} aria-hidden="true" />
                  Karaoke mix
                </button>
              ) : null}
              {showTranslate ? (
                <button type="button" className="lyrics-dock__item" onClick={(event) => runFromMenu(event, onToggleTranslate)}>
                  {translating ? <LoaderCircle size={16} aria-hidden="true" /> : <Languages size={16} aria-hidden="true" />}
                  {translating ? 'Translating…' : translated ? 'Show original' : 'Translate'}
                </button>
              ) : null}
              {onLoadAlternatives ? (
                <button
                  type="button"
                  className="lyrics-dock__item"
                  onClick={(event) => runFromMenu(event, toggleAlternatives)}
                  aria-expanded={alternativesOpen}
                  aria-controls="lyrics-alternatives"
                >
                  <RefreshCw size={16} aria-hidden="true" />
                  Other lyrics
                </button>
              ) : null}
              <button
                type="button"
                className={`lyrics-dock__item${letters ? '' : ' is-on'}`}
                onClick={(event) => runFromMenu(event, toggleLineByLine)}
                aria-pressed={!letters}
              >
                <AlignLeft size={16} aria-hidden="true" />
                Line by line
              </button>
              {hideBackdrop ? (
                <button
                  type="button"
                  className={`lyrics-dock__item${settings.playerBlackBackground ? ' is-on' : ''}`}
                  onClick={(event) => runFromMenu(event, toggleBlackBackground)}
                  aria-pressed={settings.playerBlackBackground}
                >
                  <Moon size={16} aria-hidden="true" />
                  Black background
                </button>
              ) : null}
            </div>
          ) : null}
          {showSourceInfo && sourceInfoOpen ? (
            <div id="lyrics-source-info" className="lyrics-dock__info">
              {source ? <span className="ytm-lyrics__source">{formatSource(source)}</span> : null}
              {matchReason ? <span>{matchReason}</span> : null}
            </div>
          ) : null}
          <div className="lyrics-dock__row">
            <button
              type="button"
              className={`lyrics-dock__info-btn lyrics-dock__more-btn${moreOpen ? ' is-open' : ''}`}
              onClick={() => {
                setSourceInfoOpen(false);
                setMoreOpen(!moreOpen);
              }}
              aria-expanded={moreOpen}
              aria-controls="lyrics-more-menu"
              aria-label="More lyrics options"
              title="More"
            >
              <Ellipsis size={16} aria-hidden="true" />
            </button>
            {showSourceInfo ? (
              <button
                type="button"
                className={`lyrics-dock__info-btn${sourceInfoOpen ? ' is-open' : ''}`}
                onClick={() => {
                  setMoreOpen(false);
                  setSourceInfoOpen(!sourceInfoOpen);
                }}
                aria-expanded={sourceInfoOpen}
                aria-controls="lyrics-source-info"
                aria-label="Lyrics source"
                title="Lyrics source"
              >
                <Info size={13} aria-hidden="true" />
              </button>
            ) : null}
            {plain ? <button type="button" className="lyrics-sync__value"
              aria-label={plainPaused || followPaused || !settings.autoScrollPlainLyrics ? 'Resume lyrics auto-scroll' : 'Pause lyrics auto-scroll'}
              onClick={() => {
                if (plainPaused || followPaused || !settings.autoScrollPlainLyrics) {
                  updateSettings({ autoScrollPlainLyrics: true });
                  setPlainPaused(false);
                  resumeFollowNow();
                } else {
                  plainNeedsAnchorRef.current = true;
                  setPlainPaused(true);
                }
              }}>
              {plainPaused || followPaused || !settings.autoScrollPlainLyrics ? '▶ Auto-scroll' : 'Ⅱ Auto-scroll'}
            </button> : <div className="lyrics-sync" role="group" aria-label="Adjust lyrics timing">
              <button type="button" className="lyrics-sync__btn" onClick={() => nudgeSync(-0.1)} aria-label="Show lyrics 0.1 seconds earlier">
                <Minus size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="lyrics-sync__value"
                onClick={() => setSyncOffset(0)}
                disabled={syncOffset === 0}
                aria-label="Reset lyrics timing"
                title="Reset timing"
              >
                {syncOffset > 0 ? '+' : ''}{syncOffset.toFixed(1)}s
              </button>
              <button type="button" className="lyrics-sync__btn" onClick={() => nudgeSync(0.1)} aria-label="Show lyrics 0.1 seconds later">
                <Plus size={12} aria-hidden="true" />
              </button>
            </div>}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatSource(source: string): string {
  if (source === 'interpolated') return 'Plain lyrics';
  if (source === 'LRCLIB-search') return 'LRCLIB match';
  return source.replace(/\(([^)]+)\)/, ' · $1');
}

/** The panel's no-lyrics and couldn't-load states: a small mark, a title, one line, and what to do next. */
function LyricsMessage({ tone, title, copy, children }: { readonly tone: 'empty' | 'error'; readonly title: string; readonly copy: string; readonly children?: ReactNode }) {
  return (
    <div className={`lyrics-message lyrics-message--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span className="lyrics-message__mark" aria-hidden="true">
        {tone === 'empty' ? (
          <span className="lyric-wave lyric-wave--idle"><i /><i /><i /><i /><i /></span>
        ) : (
          <WifiOff size={24} strokeWidth={1.8} />
        )}
      </span>
      <strong className="lyrics-message__title">{title}</strong>
      <p className="lyrics-message__copy">{copy}</p>
      {children ? <div className="lyrics-message__actions">{children}</div> : null}
    </div>
  );
}

/** The first sung line of a version, so two versions can be told apart by their words. */
function alternativePreview(alternative: LyricsPayload): string {
  const line = alternative.lines.find((item) => {
    const text = item.text.trim();
    return text && text !== '[INSTRUMENTAL]' && text !== '🎵';
  });
  return line?.text.trim() ?? '';
}

/** Line count plus what the match was filed under; "Synced" and "Title match" are already implied. */
function alternativeMeta(alternative: LyricsPayload): string {
  const reasons = alternative.matchReason
    .split(' • ')
    .map((part) => part.trim())
    .filter((part) => part && !['Synced', 'Plain text', 'Title match', 'Best available match'].includes(part));
  return [`${alternative.lines.length} lines`, ...reasons].join(' · ');
}

const LyricLineButton = memo(function LyricLineButton({
  line,
  translation,
  index,
  activeIndex,
  sweep,
  onActivate,
  lineRefs
}: {
  readonly line: LyricLine;
  readonly translation: string | null;
  readonly index: number;
  readonly activeIndex: number;
  /** The line's words, when it is lit letter by letter; the panel's frame loop writes each word's `--p`. */
  readonly sweep: readonly DisplayWord[] | null;
  readonly onActivate: (timestamp: number) => void;
  readonly lineRefs: MutableRefObject<Record<number, HTMLButtonElement | null>>;
}) {
  const distance = Math.abs(index - activeIndex);
  const state =
    index === activeIndex
      ? 'is-active'
      : index < activeIndex
        ? distance > 2
          ? 'is-past is-distant'
          : 'is-past'
        : distance > 2
          ? 'is-future is-distant'
          : 'is-future';

  const instrumental = isInstrumental(line.text);

  return (
    <button
      className={`ytm-lyrics__line ${state}${sweep ? ' is-sweeping' : ''}`}
      type="button"
      ref={(element) => {
        lineRefs.current[index] = element;
      }}
      onClick={() => onActivate(line.timestamp)}
      aria-current={index === activeIndex ? 'true' : undefined}
      style={{ '--lyric-fade': lineOpacity(distance, index === activeIndex) } as CSSProperties}
    >
      {instrumental ? (
        <span className="ytm-lyrics__instrumental" aria-label="Instrumental break">
          <span className="lyric-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        </span>
      ) : sweep ? (
        <SweepWords words={sweep} rtl={isRtlText(line.text)} />
      ) : (
        line.text
      )}
      {translation ? (
        <span className="ytm-lyrics__translation" lang="en">
          {translation}
        </span>
      ) : null}
    </button>
  );
});

/** The translation worth showing under a line: none for breaks, blanks, or a line already in English. */
function translationFor(line: LyricLine, translated: string | undefined): string | null {
  const text = translated?.trim();
  if (!text || text === '[INSTRUMENTAL]' || text === '🎵') return null;
  return text.toLowerCase() === line.text.trim().toLowerCase() ? null : text;
}

/** Where the sung line rests in the lyrics viewport: 0 is the top edge, 0.5 dead centre. */
const ACTIVE_LINE_ANCHOR = 0.4;
/** The active line's top never rests above this: the top fog (`.ytm-lyrics__edge`, 18% tall) sits there. */
const FOG_CLEARANCE = 0.2;

function lineOpacity(distance: number, active: boolean): number {
  if (active) return 1;
  if (distance === 1) return 0.56;
  if (distance === 2) return 0.36;
  if (distance === 3) return 0.27;
  return 0.2;
}

function isInstrumental(text: string): boolean {
  return text === '[INSTRUMENTAL]' || text === '🎵';
}

/**
 * A line lit letter by letter: each word is its resting text with a bright copy over it,
 * revealed by a clip that slides with `--p` (0..1, set per frame by the panel). Both moves
 * are transforms in % of the word's own width, so nothing is measured and nothing reflows.
 */
function SweepWords({ words, rtl }: { readonly words: readonly DisplayWord[]; readonly rtl: boolean }) {
  return (
    <span className={`lyric-words${rtl ? ' is-rtl' : ''}`}>
      {words.map((word, index) => (
        <Fragment key={index}>
          <span className="lyric-word">
            <span className="lyric-word__base">{word.text}</span>
            <span className="lyric-word__fill" aria-hidden="true">
              <span>{word.text}</span>
            </span>
          </span>
          {word.gapAfter ? ' ' : ''}
        </Fragment>
      ))}
    </span>
  );
}
