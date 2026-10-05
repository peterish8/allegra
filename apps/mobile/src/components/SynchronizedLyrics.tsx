/**
 * Time-synced lyrics, flowing the way Echo Music moves them.
 *
 * How a line is lit:
 *   - Letter by letter (Settings → Lyrics → Highlight, the default): each word
 *     fills from its first letter to its last as it is sung, syllable by
 *     syllable when the source is word-timed (YouLyPlus, BetterLyrics, Apple
 *     Music via Paxsenix — see `@shared/wordSync`), on estimated timings spread
 *     over the letters when it is only line-timed. The fill is a clip that
 *     slides across a bright copy of the word (two transforms, UI thread), drawn
 *     only on the lines around the sung one.
 *   - Line by line: the sung line brightens as a whole.
 *   Either way a line changes only opacity, never its size or layout, so the
 *   measured offsets never shift under the list. The lines just sung stay
 *   brighter than the ones to come, falling off with distance.
 *
 * How the page moves:
 *   - A line goes live a beat before it is sung (`LINE_LEAD_S`), so the page is
 *     already moving when the singing starts.
 *   - The list jumps to its new offset in one frame and the block of lines is
 *     pushed back by the same distance (`glide`, one transform on one view), so
 *     nothing moves on screen yet; the block then eases home on a critically
 *     damped follow (`glideStep`). A new line mid-flight adds to what is left and
 *     keeps the speed it had, so the lines flow on instead of restarting.
 *   - A seek slides the same way, from at most 60% of the height away.
 *   - The sung line's centre sits at `activeLinePosition` of the height, so a
 *     wrapped line is balanced around the same point as a short one. Where a
 *     line is comes from its own measured box, never from adding up estimates
 *     (`playback/lyricLayout`), and the space after the last line lets the
 *     last lines reach that point too.
 *   - Reduce Motion: no glide, and words light whole as they start.
 *
 * Scroll by hand and the lines stay put, every line bright enough to read.
 * Following resumes on the next line change once you've let go for half a
 * second and the sung line is on screen (Apple's rule), after 3.5 s
 * regardless, at once from the pill, or when you scroll back to it yourself.
 */
import React, { useEffect, useRef, useCallback, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { View, Dimensions, Text, Pressable, StyleSheet, LayoutChangeEvent, TextStyle, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  useDerivedValue,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useFrameCallback,
  useReducedMotion,
  scrollTo,
  runOnJS,
  SharedValue,
} from 'react-native-reanimated';
import type { FrameCallback, FrameInfo } from 'react-native-reanimated';
import { DisplayWord, displayWords, isRtlText, LyricWord } from '@shared/wordSync';
import { useSettingsStore } from '../store/settingsStore';
import { usePlayerStore } from '../store/playerStore';
import { lyricClockAt } from '../playback/lyricClock';
import { featherAlphas, featherAt, glideSettled, glideStep, lineRestOpacity, LINE_LEAD_S, lyricSweep } from '../playback/lyricMotion';
import { isLowEndDevice } from '../utils/performanceTier';
import { anchorFooter, anchorScrollY, LineBox, lineOffsets } from '../playback/lyricLayout';
import InstrumentalWaveform, { isInstrumentalLyric, useIsActiveLine } from './InstrumentalWaveform';
import { Frosted } from './allegra/Frosted';
import { Motion, Signal } from '../constants/allegraTheme';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * How close to the playing line counts as "back where you started" — scroll
 * within this many px of it and auto-follow re-attaches without a tap.
 */
const RESUME_SNAP_PX = 72;
/** Hands off for at most this long after a manual scroll. */
const AUTO_RESUME_MS = 3500;
/** Apple's rule: the next line change re-attaches once the list has been still this long. */
const EARLY_RESUME_MS = 500;
const DEFAULT_TEXT: TextStyle = { fontSize: 28, lineHeight: 34, textAlign: 'left' };
const DEFAULT_GAP = 16;

/** The sung line brightens (and the last one dims) on a short fade alongside the glide. */
const DIM_MS = 360;
const DIM_EASE = Motion.ease.standard;
/** The space after a word, as a share of the text size (SF Pro's word space). */
const WORD_SPACE_EM = 0.28;
/**
 * A line with more words than this lights as a whole: every swept word is three views and
 * a per-frame mapper, and a run-on line (a transcript pasted as one line) would mount hundreds.
 */
const MAX_SWEEP_WORDS = 24;

export interface SyncedLyric {
  timestamp: number;
  text: string;
  /** Word (or syllable) timings, when the source has them. */
  words?: readonly LyricWord[];
}

// ------------------------------------------------------------------
// LyricLine
// ------------------------------------------------------------------

interface LyricLineProps {
  text: string;
  words?: readonly LyricWord[];
  activeIndexSV: SharedValue<number>;
  readingSV: SharedValue<boolean>;
  /** Whether the lyrics are on screen (see `SynchronizedLyricsProps.live`). */
  liveSV: SharedValue<boolean>;
  /** The lyric clock (seconds) and the listener's timing offset, for the letter sweep. */
  clockSV: SharedValue<number>;
  delaySV: SharedValue<number>;
  timestamp: number;
  /** When the next line starts: estimated word timings finish before it. */
  nextTimestamp?: number;
  index: number;
  /** Light the line letter by letter (Settings → Lyrics → Highlight). */
  letters: boolean;
  reduceMotion: boolean;
  onLyricPress: (timestamp: number) => void;
  /** The line's box: its top inside the block of lines, and its height. */
  onMeasured: (index: number, y: number, height: number) => void;
  textStyle: TextStyle;
  gap: number;
  songTitle?: string;
}

/** Where the song's title sits in a line (its first match), as a character range. */
const titleRange = (text: string, songTitle?: string): [number, number] | null => {
  if (!songTitle) return null;
  const lowerTitle = songTitle.toLowerCase().trim();
  if (lowerTitle.length < 2) return null;
  const idx = text.replace(/\s+/g, ' ').toLowerCase().indexOf(lowerTitle);
  return idx === -1 ? null : [idx, idx + lowerTitle.length];
};

const LyricLine = React.memo(({
  text,
  words,
  activeIndexSV,
  readingSV,
  liveSV,
  clockSV,
  delaySV,
  timestamp,
  nextTimestamp,
  index,
  letters,
  reduceMotion,
  onLyricPress,
  onMeasured,
  textStyle,
  gap,
  songTitle,
}: LyricLineProps) => {
  const handlePress = useCallback(() => onLyricPress(timestamp), [onLyricPress, timestamp]);
  const isInstrumental = useMemo(() => isInstrumentalLyric(text), [text]);
  const display = useMemo(() => {
    if (!letters || isInstrumental) return null;
    const shaped = displayWords({ timestamp, text, words }, nextTimestamp, true);
    return shaped && shaped.length <= MAX_SWEEP_WORDS ? shaped : null;
  }, [letters, isInstrumental, timestamp, text, words, nextTimestamp]);
  const sweeping = display !== null;
  const rtl = useMemo(() => isRtlText(text), [text]);

  // Every report goes up: React Native only sends one when the row's frame changed, and the list must hear each
  // one (a row that kept its frame across new lyrics sends nothing, so its last report has to stay valid).
  const handleLayout = useCallback((e: LayoutChangeEvent) => {
    const { y, height } = e.nativeEvent.layout;
    onMeasured(index, y, height);
  }, [onMeasured, index]);

  // ── How it looks: dimmed at rest, bright while sung ─────────────────────
  // Only opacity moves on a line; where it sits is the block's glide. When the
  // letters sweep, this dims the line's resting text and the sweep paints the
  // sung letters over it.
  const dimStyle = useAnimatedStyle((): ViewStyle => {
    const active = activeIndexSV.value;
    const target = lineRestOpacity(index, active, readingSV.value, sweeping);
    // Far from the sung line: plain values, no animation to run.
    const far = active >= 0 && Math.abs(index - active) > 6;
    return { opacity: far ? target : withTiming(target, { duration: DIM_MS, easing: DIM_EASE }) };
  });

  // The sweep is drawn only around the sung line: the one just sung (fading
  // out), the sung one, and the next (ready before it starts).
  const [near, setNear] = useState(false);
  useAnimatedReaction(
    () => {
      const active = activeIndexSV.value;
      return sweeping && index >= active - 1 && index <= active + 1;
    },
    (now, prev) => {
      if (now !== prev) runOnJS(setNear)(now);
    },
    [index, sweeping],
  );

  const title = useMemo(() => titleRange(text, songTitle), [text, songTitle]);

  const renderedText = useMemo(() => {
    if (!title) return text;
    const cleanText = text.replace(/\s+/g, ' ');
    return (
      <Text>
        {cleanText.substring(0, title[0])}
        <Text style={styles.titleGlow}>{cleanText.substring(title[0], title[1])}</Text>
        {cleanText.substring(title[1])}
      </Text>
    );
  }, [text, title]);

  if (isInstrumental || !display) {
    return (
      <View onLayout={handleLayout} style={{ paddingVertical: gap }}>
        <Animated.View style={dimStyle}>
          <Pressable onPress={handlePress} style={styles.linePressable}>
            {isInstrumental ? (
              <InstrumentalLine activeIndexSV={activeIndexSV} liveSV={liveSV} index={index} />
            ) : (
              <Text style={[styles.lyricText, textStyle]}>{renderedText}</Text>
            )}
          </Pressable>
        </Animated.View>
      </View>
    );
  }

  return (
    <View onLayout={handleLayout} style={{ paddingVertical: gap }}>
      <Pressable onPress={handlePress} style={styles.linePressable}>
        {/* The sweep sits over exactly the box the resting words fill. */}
        <View>
          <Animated.View style={dimStyle}>
            <WordRow words={display} textStyle={textStyle} title={title} rtl={rtl} />
          </Animated.View>
          {near ? (
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <SweepRow
                words={display}
                textStyle={textStyle}
                rtl={rtl}
                index={index}
                activeIndexSV={activeIndexSV}
                clockSV={clockSV}
                delaySV={delaySV}
                reduceMotion={reduceMotion}
              />
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
});

/** How the words of a row flow: the line's alignment, right to left for Arabic and Hebrew. */
const rowStyle = (textStyle: TextStyle, rtl: boolean): ViewStyle => {
  const align = textStyle.textAlign;
  const toEnd = (align === 'right') !== rtl;
  return {
    flexDirection: rtl ? 'row-reverse' : 'row',
    flexWrap: 'wrap',
    justifyContent: align === 'center' ? 'center' : toEnd ? 'flex-end' : 'flex-start',
  };
};

const gapStyle = (word: DisplayWord, textStyle: TextStyle, rtl: boolean): ViewStyle | undefined => {
  if (!word.gapAfter) return undefined;
  const space = (textStyle.fontSize ?? 28) * WORD_SPACE_EM;
  return rtl ? { marginLeft: space } : { marginRight: space };
};

interface WordRowProps {
  words: DisplayWord[];
  textStyle: TextStyle;
  title: [number, number] | null;
  rtl: boolean;
}

/** The line's resting text, a word at a time so the sweep can sit exactly over each word. */
const WordRow = React.memo(({ words, textStyle, title, rtl }: WordRowProps) => {
  let at = 0;
  return (
    <View style={rowStyle(textStyle, rtl)}>
      {words.map((w, i) => {
        const from = at;
        at += w.text.length + (w.gapAfter ? 1 : 0);
        const inTitle = title !== null && from < title[1] && from + w.text.length > title[0];
        return (
          <View key={i} style={gapStyle(w, textStyle, rtl)}>
            <Text style={[styles.lyricText, textStyle, inTitle && styles.titleGlow]}>{w.text}</Text>
          </View>
        );
      })}
    </View>
  );
});

interface SweepRowProps {
  words: DisplayWord[];
  textStyle: TextStyle;
  rtl: boolean;
  index: number;
  activeIndexSV: SharedValue<number>;
  clockSV: SharedValue<number>;
  delaySV: SharedValue<number>;
  reduceMotion: boolean;
}

/**
 * The sung letters: the same words laid out the same way over the resting row,
 * each a bright copy revealed by a sliding clip. Shown while its line is sung,
 * fading out once the next line takes over.
 */
const SweepRow = ({ words, textStyle, rtl, index, activeIndexSV, clockSV, delaySV, reduceMotion }: SweepRowProps) => {
  const shownStyle = useAnimatedStyle((): ViewStyle => {
    const target = activeIndexSV.value === index ? 1 : 0;
    return { opacity: withTiming(target, { duration: DIM_MS, easing: DIM_EASE }) };
  });
  return (
    <Animated.View style={[rowStyle(textStyle, rtl), shownStyle]}>
      {words.map((w, i) => (
        <SweepWord
          key={i}
          word={w}
          textStyle={textStyle}
          rtl={rtl}
          clockSV={clockSV}
          delaySV={delaySV}
          reduceMotion={reduceMotion}
        />
      ))}
    </Animated.View>
  );
};

interface SweepWordProps {
  word: DisplayWord;
  textStyle: TextStyle;
  rtl: boolean;
  clockSV: SharedValue<number>;
  delaySV: SharedValue<number>;
  reduceMotion: boolean;
}

const SweepWord = ({ word, textStyle, rtl, clockSV, delaySV, reduceMotion }: SweepWordProps) => {
  const segments = word.segments;
  const weight = word.weight;
  const widthSV = useSharedValue(0);
  // The sung part of the word, 0..1, shared by the copies that make its soft edge.
  const litSV = useDerivedValue(() => {
    const lit = lyricSweep(clockSV.value + delaySV.value, segments, weight);
    return reduceMotion ? (lit > 0 ? 1 : 0) : lit;
  });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    widthSV.value = e.nativeEvent.layout.width;
  }, [widthSV]);
  // One hard-edged copy under Reduce Motion, two on a low-end phone, three otherwise.
  const count = reduceMotion ? 1 : isLowEndDevice() ? 2 : 3;
  const alphas = featherAlphas(count);
  return (
    <View style={gapStyle(word, textStyle, rtl)}>
      <Text style={[styles.lyricText, textStyle, styles.sizer]} onLayout={onLayout}>{word.text}</Text>
      {alphas.map((alpha, step) => (
        <SweepCopy
          key={step}
          text={word.text}
          textStyle={textStyle}
          rtl={rtl}
          litSV={litSV}
          widthSV={widthSV}
          step={step}
          count={count}
          alpha={alpha}
        />
      ))}
    </View>
  );
};

interface SweepCopyProps {
  text: string;
  textStyle: TextStyle;
  rtl: boolean;
  litSV: SharedValue<number>;
  widthSV: SharedValue<number>;
  step: number;
  count: number;
  alpha: number;
}

/**
 * One bright copy of a word, revealed by a sliding clip. How much of the word is still unlit, in px: the clip slides
 * that far back and the bright copy slides forward by the same, so the letters stay put. Stacked copies sit a step
 * apart (`featherAt`), which is what makes the edge soft.
 */
const SweepCopy = ({ text, textStyle, rtl, litSV, widthSV, step, count, alpha }: SweepCopyProps) => {
  const unlitSV = useDerivedValue(() => (1 - featherAt(litSV.value, step, count)) * widthSV.value);
  const clipStyle = useAnimatedStyle((): ViewStyle => ({
    opacity: widthSV.value > 0 ? alpha : 0,
    transform: [{ translateX: rtl ? unlitSV.value : -unlitSV.value }],
  }));
  const brightStyle = useAnimatedStyle((): TextStyle => ({
    transform: [{ translateX: rtl ? -unlitSV.value : unlitSV.value }],
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.sweepClip, clipStyle]}>
      <Animated.Text style={[styles.lyricText, textStyle, brightStyle]}>{text}</Animated.Text>
    </Animated.View>
  );
};

/** A music break: the waveform instead of a blank line. */
const InstrumentalLine: React.FC<{ activeIndexSV: SharedValue<number>; liveSV: SharedValue<boolean>; index: number }> = ({ activeIndexSV, liveSV, index }) => {
  const isActiveLine = useIsActiveLine(activeIndexSV, index, liveSV);
  return (
    <Animated.View style={styles.instrumentalWrap}>
      <InstrumentalWaveform active={isActiveLine} size="lg" />
    </Animated.View>
  );
};

// ------------------------------------------------------------------
// SynchronizedLyrics
// ------------------------------------------------------------------

interface SynchronizedLyricsProps {
  lyrics: SyncedLyric[];
  currentTime: number | SharedValue<number>;
  onLyricPress: (timestamp: number) => void;
  isUserScrolling?: boolean;
  onScrollStateChange?: (isScrolling: boolean) => void;
  headerContent?: React.ReactNode;
  /** Text size, line height, alignment and `marginVertical` (the gap around each line). */
  textStyle?: TextStyle;
  scrollEnabled?: boolean;
  activeLinePosition?: number;
  songTitle?: string;
  topSpacerHeight?: number;
  bottomSpacerHeight?: number;
  expandedAt?: number;
  fadeColor?: string;
  /** Android-only: soft-dissolve lyric text at the top/bottom edges (px). */
  edgeFade?: number;
  /** Mirrors the list's scroll offset, so the player sheet knows when the lines sit at the top. */
  scrollOffset?: SharedValue<number>;
  /**
   * The lines are on screen. Hidden lyrics are inert: the lyric clock does not follow the song, the sung line
   * does not move, nothing scrolls or glides, no word sweeps and no waveform dances. A glide or waveform already
   * running is stopped, and on reopening everything is put right in one step (the list jumps to the sung line,
   * with no glide from where it was when it was hidden). Default on.
   */
  live?: boolean;
}

export interface SynchronizedLyricsRef {
  scrollToIndex: (params: { index: number; animated?: boolean; viewPosition?: number }) => void;
}

const SynchronizedLyrics = forwardRef<SynchronizedLyricsRef, SynchronizedLyricsProps>(({
  lyrics,
  currentTime,
  onLyricPress,
  isUserScrolling = false,
  onScrollStateChange,
  headerContent,
  textStyle: textStyleProp,
  scrollEnabled = true,
  activeLinePosition = 0.35,
  songTitle,
  topSpacerHeight = SCREEN_HEIGHT * 0.4,
  bottomSpacerHeight = SCREEN_HEIGHT * 0.4,
  edgeFade = 0,
  scrollOffset,
  live = true,
}, ref) => {
  // The gap is padding on each row (the same for every line); the text itself
  // carries no margin, so a row's height is exactly text + 2 × gap.
  const { textStyle, gap } = useMemo(() => {
    const flat = StyleSheet.flatten([DEFAULT_TEXT, textStyleProp]) ?? DEFAULT_TEXT;
    const { marginVertical, margin } = flat;
    const g = typeof marginVertical === 'number' ? marginVertical : typeof margin === 'number' ? margin : DEFAULT_GAP;
    const rest: TextStyle = { ...flat };
    delete rest.marginVertical; delete rest.margin; delete rest.marginTop; delete rest.marginBottom;
    return { textStyle: rest, gap: g };
  }, [textStyleProp]);
  const estimate = (textStyle.lineHeight ?? Math.round((textStyle.fontSize ?? 28) * 1.22)) + gap * 2;

  const scrollRef = useAnimatedRef<Animated.ScrollView>();

  // Each line's measured box (its top inside the block of lines, and its height) and where the block starts in
  // the content (below the spacer and any header). Offsets and heights are mirrored to the UI thread for the worklets.
  //
  // The boxes are never cleared, not for new lyrics, a new text size or the highlight switch: rows are keyed by
  // index and stay mounted, and React Native reports a row's box when it mounts and whenever its frame changes,
  // so the last report is always the row's real box. Clearing them on new lyrics (as this once did) dropped every
  // row whose frame happened not to change, its box fell back to a one-row estimate, and with wrapped lines the
  // arithmetic ran a row short per line, so the sung line slid further down the screen as the song went on.
  const itemBoxes = useRef<(LineBox | undefined)[]>([]);
  const linesTop = useRef<number | null>(null);
  const itemOffsets = useRef<number[]>([]);
  const itemHeights = useRef<number[]>([]);
  const itemOffsetsSV = useSharedValue<number[]>([]);
  const itemHeightsSV = useSharedValue<number[]>([]);
  const containerHeightSV = useSharedValue(0);
  const contentHeightSV = useSharedValue(0);
  const isUserScrollingSV = useSharedValue(false);
  useEffect(() => { isUserScrollingSV.value = isUserScrolling; }, [isUserScrolling, isUserScrollingSV]);
  // The viewport's height in React too (it changes only on layout), for the space after the last line.
  const [viewportHeight, setViewportHeight] = useState(0);

  const recomputeOffsets = useCallback(() => {
    const { offsets, heights } = lineOffsets(linesTop.current ?? topSpacerHeight, itemBoxes.current, lyrics.length, estimate);
    itemOffsets.current = offsets;
    itemHeights.current = heights;
    itemOffsetsSV.value = offsets;
    itemHeightsSV.value = heights;
  }, [topSpacerHeight, lyrics.length, itemOffsetsSV, itemHeightsSV, estimate]);

  useEffect(() => { recomputeOffsets(); }, [recomputeOffsets, lyrics]);

  // Boxes arrive a line at a time as they lay out (and every line below one
  // that grew moves); batch them into one offsets update per frame.
  const pendingFrame = useRef<number | null>(null);
  const recomputeOffsetsRef = useRef(recomputeOffsets);
  recomputeOffsetsRef.current = recomputeOffsets;
  const scheduleRecompute = useCallback(() => {
    if (pendingFrame.current != null) return;
    pendingFrame.current = requestAnimationFrame(() => {
      pendingFrame.current = null;
      // A song/settings update may have landed since this frame was queued.
      recomputeOffsetsRef.current();
    });
  }, []);
  const handleItemMeasured = useCallback((idx: number, y: number, height: number) => {
    const known = itemBoxes.current[idx];
    if (known && known.y === y && known.height === height) return;
    itemBoxes.current[idx] = { y, height };
    scheduleRecompute();
  }, [scheduleRecompute]);
  const handleLinesLayout = useCallback((e: LayoutChangeEvent) => {
    const y = e.nativeEvent.layout.y;
    if (linesTop.current === y) return;
    linesTop.current = y;
    scheduleRecompute();
  }, [scheduleRecompute]);
  useEffect(() => () => { if (pendingFrame.current != null) cancelAnimationFrame(pendingFrame.current); }, []);

  // Selector, not the whole store: this component re-renders while lyrics scroll.
  const lyricsDelay = useSettingsStore(s => s.lyricsDelay);
  const letters = useSettingsStore(s => s.lyricsHighlight) !== 'lines';
  const reduceMotion = useReducedMotion();
  const delaySV = useSharedValue(lyricsDelay);
  useEffect(() => { delaySV.value = lyricsDelay; }, [lyricsDelay, delaySV]);
  // Visibility, mirrored for the UI thread. A worklet reads this, never a React ref or prop.
  const liveSV = useSharedValue(live);
  useEffect(() => { liveSV.value = live; }, [live, liveSV]);
  // Only the start times go to the UI thread for the line search, not every word.
  const timestamps = useMemo(() => lyrics.map(l => l.timestamp), [lyrics]);

  // currentTime may be a number or a shared value.
  const currentTimeNumberSV = useSharedValue(typeof currentTime === 'number' ? currentTime : 0);
  const currentTimeSV: SharedValue<number> =
    typeof currentTime === 'number' ? currentTimeNumberSV : currentTime as SharedValue<number>;
  useEffect(() => {
    if (typeof currentTime === 'number') currentTimeNumberSV.value = currentTime;
  }, [currentTime, currentTimeNumberSV]);

  // The sung line — a binary search on the UI thread.
  // The lyric clock: the player's position (reported about four times a second) carried on a frame at a time
  // while a song plays, so a line switches when it is sung rather than up to a quarter second later, and in
  // steps of that size. A new report puts it right; paused or hidden, it just is the last report, and no
  // frame callback runs at all (nothing ticks when nothing is watching).
  const playing = usePlayerStore(s => s.isPlaying);
  const clockSV = useSharedValue(typeof currentTime === 'number' ? currentTime : 0);
  const anchorPositionSV = useSharedValue(0);
  const anchorAtSV = useSharedValue(0);
  const clockRunningSV = useSharedValue(false);
  // Hidden lyrics take no reports at all (-1 stands for "not watching"): the clock, and everything that follows
  // it, stays where it was. Reopening reads the position again, which is what resynchronises them.
  useAnimatedReaction(
    () => (liveSV.value ? currentTimeSV.value : -1),
    position => {
      if (position < 0) return;
      anchorPositionSV.value = position;
      anchorAtSV.value = Date.now();
      if (!clockRunningSV.value) clockSV.value = position;
    },
  );
  // Frame callbacks are stable functions: useFrameCallback re-registers on the UI thread whenever
  // its callback changes, and an inline one changed on every render.
  const clockTick = useCallback(() => {
    'worklet';
    clockSV.value = lyricClockAt(anchorPositionSV.value, anchorAtSV.value, Date.now(), clockSV.value);
  }, [clockSV, anchorPositionSV, anchorAtSV]);
  const clockFrame = useFrameCallback(clockTick, false);
  const clockRunning = live && playing && lyrics.length > 0;
  useEffect(() => {
    clockRunningSV.value = clockRunning;
    clockFrame.setActive(clockRunning);
    if (!clockRunning) clockSV.value = anchorPositionSV.value;
  }, [clockRunning, clockFrame, clockRunningSV, clockSV, anchorPositionSV]);

  // A line goes live LINE_LEAD_S before it is sung, so the page is already on its way.
  const activeIndexDV = useDerivedValue(() => {
    const et = clockSV.value + delaySV.value + LINE_LEAD_S;
    if (timestamps.length === 0) return -1;
    let left = 0, right = timestamps.length - 1, result = -1;
    while (left <= right) {
      // eslint-disable-next-line no-bitwise
      const mid = (left + right) >>> 1;
      const nextTs = timestamps[mid + 1];
      if (et >= timestamps[mid] && (nextTs === undefined || et < nextTs)) {
        result = mid;
        break;
      }
      if (et < timestamps[mid]) right = mid - 1;
      else left = mid + 1;
    }
    return result;
  });

  const activeIndexSV = useSharedValue(-1);
  useAnimatedReaction(
    () => activeIndexDV.value,
    (next, prev) => {
      if (next !== prev) activeIndexSV.value = next;
    },
  );

  /** Where the list wants to be: the sung line's centre at `activeLinePosition`. */
  const activeTargetYSV = useDerivedValue(() => {
    const idx = activeIndexDV.value;
    const offsets = itemOffsetsSV.value;
    const heights = itemHeightsSV.value;
    const viewport = containerHeightSV.value;
    const content = contentHeightSV.value;
    if (idx < 0 || idx >= offsets.length || viewport <= 0 || content <= 0) return -1;
    // Include the content extent in the target, so a jump clamped during
    // layout is retried when the lyric rows/footer finish arriving.
    return anchorScrollY(offsets[idx], heights[idx] ?? 0, viewport, activeLinePosition, content);
  });

  // ─── Following the sung line ─────────────────────────────────────
  const scrollYSV = useSharedValue(0);
  const lastIndexSV = useSharedValue(-1);
  /** How far the list still is from the sung line's place, px. The glide scrolls the list itself, so there is one
   *  channel and nothing to fall out of step (a jump plus a compensating transform flashed one frame a line too high). */
  const glideSV = useSharedValue(0);
  /** The glide's speed (px/s), kept across line changes so the flow never restarts from rest. */
  const glideVelocitySV = useSharedValue(0);
  const glideRunningSV = useSharedValue(false);
  // The glide runs a frame at a time only while the lines are still moving.
  const glideFrameRef = useRef<FrameCallback | null>(null);
  const setGlideActive = useCallback((active: boolean) => {
    glideFrameRef.current?.setActive(active);
  }, []);
  const glideTick = useCallback((info: FrameInfo) => {
    'worklet';
    const target = activeTargetYSV.value;
    // Someone took the list, or the lyrics were hidden: stay where it is.
    if (target < 0 || isUserScrollingSV.value || !liveSV.value) {
      glideSV.value = 0;
      glideVelocitySV.value = 0;
      glideRunningSV.value = false;
      runOnJS(setGlideActive)(false);
      return;
    }
    const dt = Math.min(0.05, (info.timeSincePreviousFrame ?? 16) / 1000);
    const next = glideStep(glideSV.value, glideVelocitySV.value, dt);
    const settled = glideSettled(next);
    glideSV.value = settled ? 0 : next.offset;
    glideVelocitySV.value = settled ? 0 : next.velocity;
    scrollYSV.value = target + glideSV.value;
    scrollTo(scrollRef, 0, scrollYSV.value, false);
    if (settled) {
      glideRunningSV.value = false;
      runOnJS(setGlideActive)(false);
    }
  }, [activeTargetYSV, isUserScrollingSV, liveSV, scrollRef, scrollYSV, glideSV, glideVelocitySV, glideRunningSV, setGlideActive]);
  const glideFrame = useFrameCallback(glideTick, false);
  glideFrameRef.current = glideFrame;
  const stopGlide = useCallback(() => {
    'worklet';
    glideSV.value = 0;
    glideVelocitySV.value = 0;
  }, [glideSV, glideVelocitySV]);

  // Reading on your own: dragging, flinging, and when the list came to rest.
  const draggingSV = useSharedValue(false);
  const flingingSV = useSharedValue(false);
  const scrollEndAtSV = useSharedValue(0);

  const resumeFollowingRef = useRef<() => void>(() => {});
  const requestResume = useCallback(() => resumeFollowingRef.current(), []);

  useAnimatedReaction(
    () => ({ target: activeTargetYSV.value, user: isUserScrollingSV.value, idx: activeIndexDV.value, live: liveSV.value }),
    (now, prev) => {
      if (!now.live) {
        // Hidden: nothing follows the song. A glide that was under way stops where it is.
        if (prev && prev.live) {
          stopGlide();
          glideRunningSV.value = false;
          runOnJS(setGlideActive)(false);
        }
        return;
      }
      if (now.target < 0) return;
      if (now.user) {
        // Apple's rule: the next line re-attaches the list once it has been
        // still for a moment and the sung line is on screen.
        if (prev && now.idx !== prev.idx && !draggingSV.value && !flingingSV.value
          && Date.now() - scrollEndAtSV.value >= EARLY_RESUME_MS) {
          const top = itemOffsetsSV.value[now.idx] ?? -1;
          const bottom = top + (itemHeightsSV.value[now.idx] ?? 0);
          const viewTop = scrollYSV.value;
          if (top >= viewTop && bottom <= viewTop + containerHeightSV.value) runOnJS(requestResume)();
        }
        return;
      }
      if (prev && prev.live && prev.target === now.target && prev.user === now.user) return;
      const toY = now.target;
      const fromY = scrollYSV.value;
      // Coming back from hidden is a first frame too: the list jumps to the sung line, no glide from the old place.
      const firstFrame = !prev || !prev.live || lastIndexSV.value < 0;
      lastIndexSV.value = now.idx;
      if (firstFrame || Math.abs(toY - fromY) < 0.5 || reduceMotion) {
        scrollTo(scrollRef, 0, toY, false);
        scrollYSV.value = toY;
        stopGlide();
        return;
      }
      // The list eases from where it is to the new place, at the speed it already had (the glide scrolls it a frame
      // at a time). A seek starts at most 60% of the height away instead of racing across the song.
      const cap = containerHeightSV.value * 0.6;
      const startY = toY + Math.max(-cap, Math.min(cap, fromY - toY));
      if (startY !== fromY) {
        scrollTo(scrollRef, 0, startY, false);
        scrollYSV.value = startY;
      }
      glideSV.value = startY - toY;
      if (!glideRunningSV.value) {
        glideRunningSV.value = true;
        runOnJS(setGlideActive)(true);
      }
    },
  );

  const notifyScrollState = useCallback((scrolling: boolean) => {
    onScrollStateChange?.(scrolling);
  }, [onScrollStateChange]);

  // ─── Reading on your own ─────────────────────────────────────────
  /** -1 = playing line is above the viewport, 1 = below, 0 = pill hidden. */
  const [pillDirection, setPillDirection] = useState(0);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearResume = useCallback(() => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  }, []);
  useEffect(() => clearResume, [clearResume]);

  const resumeFollowing = useCallback(() => {
    clearResume();
    isUserScrollingSV.value = false;
    notifyScrollState(false);
  }, [clearResume, isUserScrollingSV, notifyScrollState]);
  resumeFollowingRef.current = resumeFollowing;

  const scheduleResume = useCallback(() => {
    clearResume();
    resumeTimer.current = setTimeout(resumeFollowing, AUTO_RESUME_MS);
  }, [clearResume, resumeFollowing]);

  // Scrolling back to the playing line re-attaches on its own — no tap needed.
  useAnimatedReaction(
    () => {
      if (!isUserScrollingSV.value) return 0;
      const target = activeTargetYSV.value;
      if (target < 0) return 0;
      const delta = target - scrollYSV.value;
      if (Math.abs(delta) < RESUME_SNAP_PX) return 0;
      return delta > 0 ? 1 : -1;
    },
    (next, prev) => {
      if (next === prev) return;
      runOnJS(setPillDirection)(next);
    },
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: e => {
      scrollYSV.value = e.contentOffset.y;
      if (scrollOffset) scrollOffset.value = e.contentOffset.y;
    },
    onBeginDrag: () => {
      draggingSV.value = true;
      // Grabbed mid-glide: the list is already where the lines are, so the finger just takes over.
      stopGlide();
      runOnJS(clearResume)();
      if (isUserScrollingSV.value) return;
      isUserScrollingSV.value = true;
      runOnJS(notifyScrollState)(true);
    },
    onEndDrag: () => {
      draggingSV.value = false;
      scrollEndAtSV.value = Date.now();
      // Always arm the resume here: on Android a slow release that isn't a
      // fling fires no momentum events, and the list stayed detached for good.
      runOnJS(scheduleResume)();
    },
    onMomentumBegin: () => {
      // A fling: wait until it settles instead.
      flingingSV.value = true;
      runOnJS(clearResume)();
    },
    onMomentumEnd: () => {
      flingingSV.value = false;
      scrollEndAtSV.value = Date.now();
      if (isUserScrollingSV.value) runOnJS(scheduleResume)();
    },
  });

  useImperativeHandle(ref, () => ({
    scrollToIndex: ({ index, animated = true, viewPosition = activeLinePosition }) => {
      const offsets = itemOffsets.current;
      if (index >= 0 && index < offsets.length) {
        const targetY = anchorScrollY(offsets[index], itemHeights.current[index] ?? 0,
          containerHeightSV.value, viewPosition, contentHeightSV.value);
        scrollRef.current?.scrollTo({ y: targetY, animated });
      }
    },
  }));

  const renderLyricLine = useCallback((item: SyncedLyric, index: number) => (
    <LyricLine
      key={`lyric_${index}`}
      activeIndexSV={activeIndexSV}
      readingSV={isUserScrollingSV}
      liveSV={liveSV}
      clockSV={clockSV}
      delaySV={delaySV}
      text={item.text}
      words={item.words}
      timestamp={item.timestamp}
      nextTimestamp={lyrics[index + 1]?.timestamp}
      index={index}
      letters={letters}
      reduceMotion={reduceMotion}
      onLyricPress={onLyricPress}
      onMeasured={handleItemMeasured}
      textStyle={textStyle}
      gap={gap}
      songTitle={songTitle}
    />
  ), [activeIndexSV, isUserScrollingSV, liveSV, clockSV, delaySV, lyrics, letters, reduceMotion, onLyricPress, handleItemMeasured, textStyle, gap, songTitle]);

  return (
    <View style={styles.container}>
      <Animated.ScrollView
        ref={scrollRef}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={false}
        // Native alpha dissolve of children at the clip edges — no MaskedView.
        // Android only; iOS ignores this prop.
        fadingEdgeLength={edgeFade > 0 ? edgeFade : undefined}
        onLayout={e => {
          const h = e.nativeEvent.layout.height;
          containerHeightSV.value = h;
          setViewportHeight(h);
        }}
        onContentSizeChange={(_w, h) => {
          contentHeightSV.value = h;
        }}
      >
        <View style={{ height: topSpacerHeight }} />
        {headerContent}
        <View onLayout={handleLinesLayout}>{lyrics.map(renderLyricLine)}</View>
        <View style={{ height: anchorFooter(viewportHeight, activeLinePosition, bottomSpacerHeight) }} />
      </Animated.ScrollView>

      {pillDirection !== 0 && (
        <Pressable
          style={styles.resumePill}
          onPress={resumeFollowing}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Back to the playing line"
        >
          <Frosted radius={18} intensity={50} tint={0.35} />
          <Ionicons name={pillDirection > 0 ? 'arrow-down' : 'arrow-up'} size={14} color={Signal.wave} />
          <Text style={styles.resumePillText}>Now playing</Text>
        </Pressable>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  // Floating over the lyrics, clear of the transport row below.
  resumePill: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    overflow: 'hidden',
  },
  resumePillText: {
    color: Signal.ink,
    fontSize: 13,
    fontWeight: '600',
  },
  container: {
    flex: 1,
    width: '100%',
  },
  // Full width, so alignment is the text's own (a short left-aligned line
  // used to sit centred as a block).
  linePressable: {
    alignSelf: 'stretch',
    paddingHorizontal: 28,
  },
  instrumentalWrap: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: 40,
  },
  lyricText: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  // Holds a sung word's place (and size) without drawing it.
  sizer: {
    opacity: 0,
  },
  sweepClip: {
    overflow: 'hidden',
  },
  // Title words inside a lyric: a soft glow, same weight so nothing re-wraps.
  titleGlow: {
    color: '#FFFFFF',
    textShadowColor: 'rgba(255,255,255,0.75)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
});

// Memoised: the player re-renders for many reasons that never touch the lines.
export default React.memo(SynchronizedLyrics);
