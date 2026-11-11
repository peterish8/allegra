import type { Transition, Variants } from 'motion/react';

export const motionTokens = {
  marquee: { pixelsPerSecond: 36, gap: 48, minimumDuration: 8 },
  duration: {
    none: 0,
    micro: 0.01,
    instant: 0.1,
    fast: 0.16,
    base: 0.24,
    panel: 0.24,
    slow: 0.4,
    cinematic: 0.7,
    /** A cover flying from its row into the transfer crate. */
    flight: 0.28,
    /** A finished sleeve dealt out of the crate. */
    deal: 0.32,
    catch: 0.5,
    catchRipple: 0.6,
    blink: 0.9,
    wave: 1.1,
    waveSteps: [1.1, 1.3, 1.5] as const,
    heartLoop: 1.4,
    heartBeat: 1.3,
    stream: 1.5,
    ripple: 1.6,
    orbiting: 1.8,
    focusPulse: 2.1,
    chipLoop: 2.2,
    float: 2.4,
    cardFlow: 2.6,
    compass: 4.2,
    ringSweep: 4,
    breathing: 6,
    orbit: 16
  },
  delay: {
    none: 0,
    micro: 0.04,
    short: 0.05,
    quick: 0.06,
    type: 0.07,
    cover: 0.08,
    heartChain: 0.36,
    line: 0.09,
    row: 0.1,
    part: 0.12,
    scene: 0.15,
    word: 0.2,
    fold: 0.24,
    loop: 0.3,
    typeStart: 0.35,
    catch: 0.45,
    stack: 0.5,
    heart: 0.55,
    chips: 0.6,
    orbit: 0.7,
    ripple: 0.8,
    hover: 0.9
  },
  ease: {
    standard: [0.4, 0, 0.2, 1] as const,
    decelerate: [0, 0, 0.2, 1] as const,
    accelerate: [0.4, 0, 1, 1] as const,
    emphasis: [0.2, 0, 0, 1] as const,
    tactile: [0.2, 0, 0, 1] as const,
    linear: 'linear' as const,
    fold: [0.4, 0, 0.9, 0.55] as const
  },
  stagger: 0.04
} as const;

/** Imperative GSAP moments use the same timing vocabulary as Motion scenes. */
export const gsapTokens = {
  hero: {
    duration: motionTokens.duration.cinematic,
    delay: motionTokens.duration.instant,
    stagger: 0.05,
    ease: 'power4.out',
    distance: 24
  }
} as const;

export const spring = {
  tactile: { type: 'spring', stiffness: 400, damping: 30 } as const,
  sheet: { type: 'spring', stiffness: 300, damping: 34 } as const,
  hero: { type: 'spring', stiffness: 220, damping: 30 } as const,
  /** Soft-focus lyrics: ~320–450ms, little/no bounce. */
  lyrics: { type: 'spring', stiffness: 260, damping: 38, mass: 0.85 } as const,
  /** Artwork breathe while playing (1 → 1.015). */
  breathe: { type: 'spring', stiffness: 120, damping: 28, mass: 1 } as const,
  /** A ball landing: stiff and under-damped, so it squashes, overshoots and wobbles back. */
  bounce: { type: 'spring', stiffness: 700, damping: 12, mass: 1 } as const,
  heart: { type: 'spring', stiffness: 520, damping: 14 } as const,
  artist: { type: 'spring', stiffness: 320, damping: 28 } as const
};

export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: motionTokens.duration.base,
      ease: motionTokens.ease.decelerate,
      staggerChildren: motionTokens.stagger
    }
  }
};

export const itemVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }
  }
};

export const reducedTransition: Transition = {
  duration: motionTokens.duration.instant,
  ease: motionTokens.ease.standard
};

export function transitionForReducedMotion(reduced: boolean, transition: Transition): Transition {
  return reduced ? reducedTransition : transition;
}

/*
 * Spatial grammar. One language, reused everywhere.
 *
 *   There is a light behind the page. Things that arrive RISE OUT of it.
 *   Things that leave SINK BACK into it. Text lifts away upward.
 *
 * Every scene change in the app uses these three poses, so a change always
 * reads as the same kind of event no matter which section it happens in.
 */

/** Arriving object: rises out of the light. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 18, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate }
  }
};

/** Leaving text: lifts and fades. */
export const exitUp = {
  opacity: 0,
  y: -14,
  transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate }
} as const;

/** Leaving object: sinks back down into the light. */
export const exitDown = {
  opacity: 0,
  y: 22,
  scale: 0.96,
  transition: { duration: motionTokens.duration.base, ease: motionTokens.ease.accelerate }
} as const;

/** Content swapping inside a container that stays put. */
export const swapVariants: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate } },
  exit: { opacity: 0, y: -10, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }
};

/** A tapped control confirms within this window, independent of any network call. */
export const ACK_MS = 120;

/**
 * The Blend reveal, played in the hero itself: orbs start far apart and spring to the distance
 * the match gives them; the number starts counting once the overlap has begun to form.
 */
export const revealTokens = {
  /** How far apart (in orb widths, each side) the orbs begin. */
  farReach: 0.95,
  /** Seconds before the orbs start travelling. */
  travelDelay: 0.08,
  /** Seconds before the match number starts counting. */
  numberDelay: 0.4,
  /** Milliseconds after which the reveal counts as finished even if a frame never came. */
  maxMs: 3000
} as const;

/** The operational-transparency ticker: at most this many visual updates a second. */
export const TICKER_PER_SECOND = 4;
/** Screen readers hear a progress summary at most this often. */
export const LIVE_SUMMARY_MS = 2000;
