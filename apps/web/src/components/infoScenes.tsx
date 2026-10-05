'use client';

/**
 * Each page's own scene for its "i" walkthrough (components/InfoTour): one object that belongs to that
 * page, acting out each step. Home lifts a song, Browse types a search, Liked Songs beats a heart,
 * a playlist builds its rows, Import moves songs between two places, Settings turns its dials, a Blend
 * lights its match ring. (Library keeps InfoTour's record sleeves; Blends has its orbiting lights.)
 *
 * Every scene is (step, reduced) => elements. Transform and opacity only. A part that belongs to one
 * step enters with a spring and leaves quickly; loops run only while their step shows. Reduced motion:
 * parts appear in place, and no loop, orbit or shuffle runs.
 */
import { AnimatePresence, motion, type Transition } from 'motion/react';
import { Check, FileText, Heart, Link2, Lock, Mic, Music2, Play, RefreshCw, Search, Share2, ShieldCheck } from 'lucide-react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

import { motionTokens, spring } from '../motion';

const CORAL = '#ee6b5f';
const BLUE = '#7bafd4';
const WAVE = 'var(--wave)';
const TONES = [CORAL, WAVE, BLUE] as const;
const cover = (index: number): string => [
  'linear-gradient(145deg, #ee6b5f, #783e44)', 'linear-gradient(145deg, #d9e66a, #5a6a1e)', 'linear-gradient(145deg, #7bafd4, #2f4d66)',
  'linear-gradient(145deg, #c58bd8, #4d2f66)', 'linear-gradient(145deg, #f2b66d, #7a4a1e)'
][index % 5]!;

type Scene = (step: number, reduced: boolean) => ReactNode;

/** One part of a scene: placed at (x, y) from the centre; springs in, leaves fast. */
function Part({ x = 0, y = 0, delay = 0, reduced, className, style, children, from }: {
  readonly x?: number; readonly y?: number; readonly delay?: number; readonly reduced: boolean;
  readonly className?: string; readonly style?: CSSProperties; readonly children?: ReactNode;
  /** Where it comes from, relative to its place. */
  readonly from?: { readonly x?: number; readonly y?: number; readonly scale?: number; readonly rotate?: number };
}) {
  return (
    <motion.span
      className={`info-scene__part${className ? ` ${className}` : ''}`}
      style={style}
      initial={reduced ? { opacity: 0, x, y } : { opacity: 0, x: x + (from?.x ?? 0), y: y + (from?.y ?? 12), scale: from?.scale ?? 0.7, rotate: from?.rotate ?? 0 }}
      animate={{ opacity: 1, x, y, scale: 1, rotate: 0 }}
      exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
      transition={reduced ? { duration: motionTokens.duration.base } : { ...spring.hero, delay }}
    >
      {children}
    </motion.span>
  );
}

/** A repeating move inside a part; nothing under reduced motion. */
function Loop({ reduced, animate, duration, delay = 0, className, style, children, times, ease = 'easeInOut' }: {
  readonly reduced: boolean; readonly animate: Record<string, number[]>; readonly duration: number; readonly delay?: number;
  readonly className?: string; readonly style?: CSSProperties; readonly children?: ReactNode; readonly times?: number[]; readonly ease?: Transition['ease'];
}) {
  return (
    <motion.span
      className={`info-scene__loop${className ? ` ${className}` : ''}`}
      style={style}
      animate={reduced ? undefined : animate}
      transition={reduced ? undefined : { duration, delay, repeat: Infinity, ease, ...(times ? { times } : {}) }}
    >
      {children}
    </motion.span>
  );
}

/** A counter that ticks every `ms` while active: drives shuffles and filters. */
function useTick(active: boolean, ms: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setInterval(() => setTick((value) => value + 1), ms);
    return () => window.clearInterval(timer);
  }, [active, ms]);
  return tick;
}

function Stage({ step, children }: { readonly step: number; readonly children: ReactNode }) {
  return (
    <div className="info-tour__stage info-scene" aria-hidden="true">
      <AnimatePresence mode="popLayout">
        <motion.div key={step} className="info-scene__step" exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast } }}>{children}</motion.div>
      </AnimatePresence>
    </div>
  );
}

// ── Home ─────────────────────────────────────────────────────────────────────

export const homeScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 0 ? <>
      <Part reduced={reduced}><Loop reduced={reduced} className="info-scene__ripple" animate={{ scale: [1, 1.7], opacity: [0.55, 0] }} duration={1.6} ease="easeOut" /></Part>
      <Part reduced={reduced} from={{ y: 40, scale: 0.8 }} className="info-scene__cover info-scene__cover--big" style={{ background: cover(1) }}>
        <span className="info-scene__play"><Play size={18} fill="currentColor" /></span>
      </Part>
    </> : step === 1 ? [-117, -39, 39, 117].map((x, i) => (
      <Part key={x} reduced={reduced} x={x} delay={i * 0.08} from={{ x: -70, y: 0, scale: 0.9 }} className={`info-scene__cover${i === 0 ? ' is-now' : ''}`} style={{ background: cover(i) }} />
    )) : step === 2 ? <>
      <Part reduced={reduced} className="info-scene__disc info-scene__disc--you">You</Part>
      <Loop reduced={reduced} className="info-scene__orbit" animate={{ rotate: [0, 360] }} duration={16} ease="linear">
        {[0, 1, 2, 3, 4].map((i) => {
          const angle = (i / 5) * Math.PI * 2;
          return (
            <Part key={i} reduced={reduced} x={Math.cos(angle) * 70} y={Math.sin(angle) * 58} delay={i * 0.06} from={{ x: 0, y: 0, scale: 0.3 }}>
              <Loop reduced={reduced} className="info-scene__disc" style={{ background: cover(i) }} animate={{ rotate: [0, -360] }} duration={16} ease="linear" />
            </Part>
          );
        })}
      </Loop>
    </> : <>
      <Part reduced={reduced} className="info-scene__heart" from={{ scale: 0.4, y: 0 }}><Heart size={76} fill="currentColor" /></Part>
      {[-60, -24, 20, 56].map((x, i) => (
        <Loop key={x} reduced={reduced} className="info-scene__mini-heart" style={{ x, y: 60, opacity: 0 }} animate={{ y: [60, -64], opacity: [0, 1, 0], x: [x, x + (i % 2 ? 14 : -14), x] }} duration={2.4} delay={i * 0.55} ease="easeOut">
          <Heart size={14} fill="currentColor" />
        </Loop>
      ))}
    </>}
  </Stage>
);

// ── Browse ───────────────────────────────────────────────────────────────────

const TYPED = 'late night drive';
const MOODS = [{ x: -110, y: -40, t: 'chill' }, { x: 0, y: -52, t: 'focus' }, { x: 104, y: -36, t: 'workout' }, { x: -86, y: 22, t: 'rain' }, { x: 30, y: 10, t: 'late night' }, { x: 116, y: 44, t: 'party' }] as const;

export const browseScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 0 ? (
      <Part reduced={reduced} className="info-scene__search" from={{ y: 20, scale: 0.92 }}>
        <Search size={16} />
        <span className="info-scene__typed">
          {TYPED.split('').map((letter, i) => (
            <motion.span key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.01, delay: reduced ? 0 : 0.35 + i * 0.07 }}>{letter === ' ' ? ' ' : letter}</motion.span>
          ))}
          <Loop reduced={reduced} className="info-scene__caret" animate={{ opacity: [1, 0, 1] }} duration={0.9} ease="linear" />
        </span>
      </Part>
    ) : step === 1 ? MOODS.map((mood, i) => (
      <Part key={mood.t} reduced={reduced} x={mood.x} y={mood.y} delay={i * 0.07} from={{ x: 0, y: 0, scale: 0.2 }} className={`info-scene__pill${mood.t === 'late night' ? ' is-on' : ''}`}>
        {mood.t === 'late night' ? <Loop reduced={reduced} animate={{ scale: [1, 1.08, 1] }} duration={1.4}>{mood.t}</Loop> : mood.t}
      </Part>
    )) : <>
      <Part reduced={reduced} className="info-scene__compass" from={{ scale: 0.6, rotate: -60 }}>
        <Loop reduced={reduced} className="info-scene__needle" animate={{ rotate: [-40, 32, -14, 22, -40] }} duration={4.2} />
      </Part>
      {[{ x: -118, y: -30 }, { x: 116, y: -42 }, { x: -98, y: 46 }, { x: 108, y: 40 }].map((spot, i) => (
        <Part key={i} reduced={reduced} x={spot.x} y={spot.y} delay={0.1 + i * 0.08}>
          <Loop reduced={reduced} className="info-scene__cover info-scene__cover--small" style={{ background: cover(i + 1) }} animate={{ y: [0, -8, 0] }} duration={2.6} delay={i * 0.3} />
        </Part>
      ))}
    </>}
  </Stage>
);

// ── Liked Songs ──────────────────────────────────────────────────────────────

function ShuffleCards({ reduced }: { readonly reduced: boolean }) {
  const tick = useTick(!reduced, 1300);
  const slots = [-78, 0, 78];
  return <>{[0, 1, 2].map((card) => {
    const slot = (card + tick) % 3;
    return (
      <motion.span
        key={card}
        className="info-scene__part info-scene__cover info-scene__cover--big"
        style={{ background: cover(card), zIndex: slot === 1 ? 2 : 1 }}
        initial={{ opacity: 0, x: 0, scale: 0.7 }}
        animate={{ opacity: slot === 1 ? 1 : 0.7, x: slots[slot], scale: slot === 1 ? 1 : 0.78, rotate: (slot - 1) * 8 }}
        transition={reduced ? { duration: 0 } : spring.hero}
      />
    );
  })}</>;
}

export const likedScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 0 ? <>
      {[{ x: -130, y: -40 }, { x: 128, y: -48 }, { x: -120, y: 50 }, { x: 132, y: 44 }, { x: 0, y: -80 }].map((from, i) => (
        <Loop key={i} reduced={reduced} className="info-scene__mini-heart" style={{ x: from.x, y: from.y, opacity: 0 }} animate={{ x: [from.x, 0], y: [from.y, 0], opacity: [0, 1, 0], scale: [1, 0.4] }} duration={1.8} delay={i * 0.36} ease="easeIn">
          <Heart size={14} fill="currentColor" />
        </Loop>
      ))}
      <Part reduced={reduced} className="info-scene__heart" from={{ scale: 0.4, y: 0 }}>
        <Loop reduced={reduced} animate={{ scale: [1, 1.14, 1, 1.08, 1] }} duration={1.3} times={[0, 0.15, 0.3, 0.45, 1]}><Heart size={76} fill="currentColor" /></Loop>
      </Part>
    </> : step === 1 ? <ShuffleCards reduced={reduced} /> : <>
      <Part reduced={reduced} className="info-scene__heart is-outline" from={{ scale: 0.8, y: 0 }}><Heart size={76} /></Part>
      <Part reduced={reduced} className="info-scene__heart">
        <motion.span className="info-scene__loop" animate={reduced ? { opacity: 0 } : { opacity: [1, 1, 0], scale: [1, 1, 0.6] }} transition={reduced ? { duration: 0 } : { duration: 1.4, times: [0, 0.4, 1], delay: 0.3 }}><Heart size={76} fill="currentColor" /></motion.span>
      </Part>
      {!reduced ? (
        <motion.span className="info-scene__part info-scene__mini-heart" initial={{ opacity: 0, x: 0, y: 0 }} animate={{ opacity: [0, 1, 0], x: [0, 60, 110], y: [0, -40, -70], rotate: [0, 20, 40] }} transition={{ duration: 1.4, delay: 0.9, ease: 'easeOut' }}>
          <Heart size={16} fill="currentColor" />
        </motion.span>
      ) : null}
    </>}
  </Stage>
);

// ── A playlist ───────────────────────────────────────────────────────────────

function Rows({ reduced, shuffle }: { readonly reduced: boolean; readonly shuffle: boolean }) {
  const tick = useTick(shuffle && !reduced, 1200);
  const order = [[0, 1, 2, 3], [2, 0, 3, 1], [3, 2, 1, 0], [1, 3, 0, 2]][tick % 4]!;
  return <>{[0, 1, 2, 3].map((row) => (
    <motion.span
      key={row}
      className="info-scene__part info-scene__row"
      initial={reduced ? { opacity: 0, x: 0, y: -33 + order.indexOf(row) * 22 } : { opacity: 0, x: 60, y: -33 + order.indexOf(row) * 22 }}
      animate={{ opacity: 1, x: 0, y: -33 + order.indexOf(row) * 22 }}
      transition={reduced ? { duration: motionTokens.duration.base } : { ...spring.hero, delay: shuffle ? 0 : 0.1 + row * 0.12 }}
    >
      <span className="info-scene__row-art" style={{ background: cover(row) }} /><span className="info-scene__row-line" />
    </motion.span>
  ))}</>;
}

export const playlistScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 2 ? <>
      {[0, 1, 2].map((i) => <Loop key={i} reduced={reduced} className="info-scene__ripple info-scene__ripple--wide" style={{ opacity: 0 }} animate={{ scale: [0.6, 2], opacity: [0.6, 0] }} duration={2.1} delay={i * 0.7} ease="easeOut" />)}
      <Part reduced={reduced} className="info-scene__badge" from={{ scale: 0.4, y: 0 }}><Link2 size={24} /></Part>
      <Part reduced={reduced} x={-110} y={0} delay={0.2} className="info-scene__disc" style={{ background: cover(0) }} />
      <Part reduced={reduced} x={110} y={0} delay={0.3} className="info-scene__disc" style={{ background: cover(2) }} />
    </> : <>
      <Part reduced={reduced} className="info-scene__panel" from={{ y: 16, scale: 0.94 }} />
      <Rows reduced={reduced} shuffle={step === 3} />
      {step === 1 ? <Part reduced={reduced} x={-96} y={-52} className="info-scene__cover info-scene__cover--drop" style={{ background: cover(3) }} from={{ y: -90, rotate: -20, scale: 1 }} /> : null}
    </>}
  </Stage>
);

// ── Import ───────────────────────────────────────────────────────────────────

export const importScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 0 ? <>
      <Part reduced={reduced} x={-120} className="info-scene__node" from={{ x: -30 }}><Music2 size={20} /></Part>
      <Part reduced={reduced} x={120} className="info-scene__node is-home" from={{ x: 30 }}>A</Part>
      <span className="info-scene__part info-scene__line" />
      {[0, 1, 2, 3].map((i) => <Loop key={i} reduced={reduced} className="info-scene__dot" style={{ x: -96, opacity: 0, background: TONES[i % 3] }} animate={{ x: [-96, 96], opacity: [0, 1, 1, 0] }} duration={1.8} delay={i * 0.45} ease="easeInOut" />)}
    </> : step === 1 ? <>
      <Part reduced={reduced} y={52} className="info-scene__tray" from={{ y: 20 }} />
      <Part reduced={reduced} y={6} className="info-scene__file" delay={0.15} from={{ x: -120, y: -90, rotate: -35, scale: 0.9 }}><FileText size={26} /><span>CSV</span></Part>
    </> : step === 2 ? <>
      <Part reduced={reduced} x={-124} className="info-scene__file is-dim" from={{ x: 0 }}><FileText size={22} /></Part>
      <Part reduced={reduced} className="info-scene__badge info-scene__badge--shield" from={{ scale: 0.5, y: 0 }}><ShieldCheck size={26} /></Part>
      <Part reduced={reduced} x={-124} y={44} delay={0.2} className="info-scene__lock"><Lock size={14} /></Part>
      {['Title', 'Artist'].map((label, i) => <Loop key={label} reduced={reduced} className="info-scene__chip" style={{ x: -80, y: -16 + i * 34, opacity: 0 }} animate={{ x: [-80, 120], opacity: [0, 1, 1, 0] }} duration={2.2} delay={i * 0.6}>{label}</Loop>)}
    </> : [0, 1, 2].map((i) => (
      <Part key={i} reduced={reduced} y={-40 + i * 40} delay={i * 0.1} className="info-scene__row info-scene__row--check" from={{ x: -40, y: 0 }}>
        <motion.span className="info-scene__tick" initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={reduced ? { duration: 0 } : { ...spring.tactile, delay: 0.5 + i * 0.35 }}><Check size={12} strokeWidth={3} /></motion.span>
        <span className="info-scene__row-art" style={{ background: cover(i) }} /><span className="info-scene__row-line" />
      </Part>
    ))}
  </Stage>
);

// ── Settings ─────────────────────────────────────────────────────────────────

const KNOBS = [[-40, 30, 0], [50, -24, 22]] as const;

export const settingsScene: Scene = (step, reduced) => (
  <Stage step={step <= 1 ? 0 : step}>
    {step <= 1 ? <>
      {[0, 1, 2].map((i) => (
        <span key={i} className="info-scene__part info-scene__slider" style={{ transform: `translate(-20px, ${-36 + i * 36}px)` }}>
          <motion.span className="info-scene__knob" initial={false} animate={{ x: KNOBS[step]![i] }} transition={reduced ? { duration: 0 } : { ...spring.hero, delay: i * 0.06 }} />
        </span>
      ))}
      <span className="info-scene__part info-scene__switch" style={{ transform: 'translate(118px, 0)' }}>
        <motion.span className="info-scene__switch-knob" initial={false} animate={{ x: step === 0 ? 0 : 20 }} transition={reduced ? { duration: 0 } : spring.tactile} />
      </span>
    </> : step === 2 ? <>
      <Part reduced={reduced} x={-110} className="info-scene__badge" from={{ scale: 0.5, y: 0 }}><Mic size={22} /></Part>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <Part key={i} reduced={reduced} x={-44 + i * 22} delay={i * 0.04} from={{ y: 20 }}>
          <Loop reduced={reduced} className="info-scene__bar" animate={{ scaleY: [0.3, 1, 0.45, 0.85, 0.3] }} duration={1.1 + (i % 3) * 0.2} delay={i * 0.08} />
        </Part>
      ))}
    </> : step === 3 ? <>
      {[0, 1, 2, 3].map((i) => <Part key={i} reduced={reduced} x={-96 + i * 64} delay={i * 0.06} className="info-scene__swatch" style={{ background: cover(i) }} />)}
      <Loop reduced={reduced} className="info-scene__part info-scene__swatch-ring" style={{ x: -96 }} animate={{ x: [-96, -32, 32, 96, -96] }} duration={4} times={[0, 0.25, 0.5, 0.75, 1]} />
    </> : step === 4 ? <>
      {[0, 1, 2].map((i) => <Loop key={i} reduced={reduced} className="info-scene__ripple info-scene__ripple--wide" style={{ opacity: 0 }} animate={{ scale: [0.7, 1.8], opacity: [0.5, 0] }} duration={2.4} delay={i * 0.8} ease="easeOut" />)}
      <Part reduced={reduced} className="info-scene__badge info-scene__badge--shield" from={{ scale: 0.4, y: 0 }}><ShieldCheck size={28} /></Part>
    </> : (
      <Part reduced={reduced} className="info-scene__phone" from={{ y: 70, rotate: -8 }}>
        <motion.span className="info-scene__phone-bar" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={reduced ? { duration: 0 } : { ...spring.hero, delay: 0.45 }} />
      </Part>
    )}
  </Stage>
);

// ── One Blend ────────────────────────────────────────────────────────────────

const RING = 24;

function LensRows({ reduced }: { readonly reduced: boolean }) {
  const tick = useTick(!reduced, 1500);
  const lens = tick % 3; // 0: everyone, 1: coral's picks, 2: blue's picks
  const rows = [0, 2, 1, 0, 2];
  return <>
    {[CORAL, BLUE].map((tone, i) => (
      <motion.span key={tone} className="info-scene__part info-scene__lens" style={{ background: tone }} initial={{ x: -128, y: -20 + i * 40, opacity: 0 }} animate={{ x: -128, y: -20 + i * 40, opacity: 1, scale: lens === i + 1 ? 1.25 : 1 }} transition={reduced ? { duration: 0 } : spring.tactile} />
    ))}
    {rows.map((tone, i) => {
      const on = lens === 0 || (lens === 1 && tone === 0) || (lens === 2 && tone === 2);
      return (
        <motion.span key={i} className="info-scene__part info-scene__row" style={{ '--stripe': TONES[tone] } as CSSProperties} initial={{ opacity: 0, x: 20, y: -52 + i * 26 }} animate={{ opacity: on ? 1 : 0.18, x: on ? 20 : 34, y: -52 + i * 26 }} transition={reduced ? { duration: 0 } : spring.hero}>
          <span className="info-scene__row-art" style={{ background: TONES[tone] }} /><span className="info-scene__row-line" />
        </motion.span>
      );
    })}
  </>;
}

export const blendScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 0 ? <>
      {Array.from({ length: RING }, (_, i) => {
        const angle = (i / RING) * Math.PI * 2 - Math.PI / 2;
        return <motion.span key={i} className="info-scene__part info-scene__ring-dot" initial={{ opacity: 0.15, x: Math.cos(angle) * 66, y: Math.sin(angle) * 66 }} animate={{ opacity: i < 19 ? 1 : 0.15, scale: i < 19 ? 1 : 0.8 }} transition={reduced ? { duration: 0 } : { duration: motionTokens.duration.base, delay: 0.2 + i * 0.05 }} />;
      })}
      <Part reduced={reduced} x={-12} className="info-scene__disc info-scene__disc--tone" style={{ background: CORAL }} from={{ x: -50 }} />
      <Part reduced={reduced} x={12} className="info-scene__disc info-scene__disc--tone" style={{ background: BLUE }} from={{ x: 50 }} />
    </> : step === 1 ? <>
      {[0, 1, 2].map((i) => <Part key={i} reduced={reduced} x={(i - 1) * 56} y={Math.abs(i - 1) * 10} delay={i * 0.08} className="info-scene__story" style={{ background: cover(i), rotate: `${(i - 1) * 12}deg`, zIndex: i === 1 ? 2 : 1 }} from={{ x: 0, y: 30, rotate: 0 }} />)}
      <Part reduced={reduced} x={70} y={-58} delay={0.5} className="info-scene__badge info-scene__badge--small" from={{ y: 0, scale: 0.4 }}>
        <Loop reduced={reduced} animate={{ y: [0, -5, 0] }} duration={1.6}><Share2 size={16} /></Loop>
      </Part>
    </> : step === 2 ? <LensRows reduced={reduced} /> : <>
      <Part reduced={reduced} className="info-scene__badge" from={{ scale: 0.5, y: 0 }}>
        <Loop reduced={reduced} animate={{ rotate: [0, 360] }} duration={2.6} ease="linear"><RefreshCw size={24} /></Loop>
      </Part>
      {[0, 1, 2].map((i) => <Part key={i} reduced={reduced} x={-110 + i * 110} y={58} delay={0.15 + i * 0.12} className="info-scene__cover info-scene__cover--small" style={{ background: cover(i + 2) }} from={{ y: 30 }} />)}
    </>}
  </Stage>
);
