import type { Transition, Variants } from 'motion/react';

export const motionTokens = {
  duration: {
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
    /** One note rising out of the DJ mascot, calm and lively (mirror --d-note-rise, --d-note-rise-lively). */
    noteRise: 4.2,
    noteRiseLively: 2.8,
    /*
     * The DJ mascot hops like a ball. Seconds in the air (a quick hop, an easy one, a lazy one), the
     * crouch before takeoff, and the rests between hops. The landing bounce is `spring.bounce`.
     */
    hopQuick: 0.34,
    hopEasy: 0.5,
    hopLazy: 0.68,
    crouch: 0.14,
    restQuick: 0.25,
    restEasy: 0.8,
    restLazy: 1.8,
    restIdle: 3.6,
    /*
     * Mostly the mascot floats: an eased glide to a new spot (quick, easy, lazy) and a soft bob of
     * this period. Hops are the occasional exception.
     */
    floatQuick: 1.6,
    floatEasy: 2.6,
    floatLazy: 4,
    floatBob: 3.4
  },
  ease: {
    standard: [0.4, 0, 0.2, 1] as const,
    decelerate: [0, 0, 0.2, 1] as const,
    accelerate: [0.4, 0, 1, 1] as const,
    emphasis: [0.2, 0, 0, 1] as const,
    tactile: [0.2, 0, 0, 1] as const
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
  bounce: { type: 'spring', stiffness: 700, damping: 12, mass: 1 } as const
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
