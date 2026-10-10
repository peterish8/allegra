'use client';

/**
 * The "i" beside a page title: a short walkthrough of what the page does, instead of a paragraph
 * under the title. One component for every page, so they all open, move and answer keys the same way.
 *
 * Motion contract: when the button is pressed, a popup rises in. One persistent object on its stage
 * changes pose per step. By default that is three record sleeves (stacked, fanned, spread, orbiting, or
 * one lifted forward) with the step's icon on a disc in front; a page can bring its own stage (Blends
 * draws its colour lights). The words swap with each step: the old lines lift out, the new title rises,
 * then its line follows a beat later. Next, Back, the dots and the arrow keys work at once, and the
 * stage retargets from wherever it is, so quick taps never jump.
 *
 * Closing (Got it, the cross, Esc, the backdrop): the words and buttons step aside, the scene plays a
 * short finishing beat (everything draws in to its centre: lights merge, sleeves stack), then the card
 * shrinks straight into the "i" it came from, which gives one small bounce as it lands.
 *
 * Transform and opacity only. Reduced motion: the stage takes each pose at once, the words fade and
 * closing is a plain fade.
 */

/** Where the "i" sits relative to the card's centre when closing starts. */
type Fold = { readonly x: number; readonly y: number } | null;
import { AnimatePresence, motion, useAnimate, useReducedMotion } from 'motion/react';
import { ArrowLeft, ArrowRight, Info, X, type LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { useFocusTrap } from '../hooks/useFocusTrap';
import { motionTokens, spring } from '../motion';

/** How the sleeves stand for a step. */
export type TourPose = 'stack' | 'fan' | 'spread' | 'orbit' | 'lift';

export interface TourStep {
  readonly title: string;
  readonly body: string;
  /** Optional numbered how-to under the line (setup instructions), a few short items. */
  readonly steps?: readonly string[];
  readonly icon: LucideIcon;
  readonly pose: TourPose;
}

type SleevePose = { readonly x: number; readonly y: number; readonly rotate: number; readonly scale: number; readonly opacity: number };
const POSES: Record<TourPose, readonly [SleevePose, SleevePose, SleevePose]> = {
  stack: [{ x: -10, y: 8, rotate: -6, scale: 0.94, opacity: 0.8 }, { x: 0, y: 0, rotate: 0, scale: 1, opacity: 1 }, { x: 10, y: -8, rotate: 6, scale: 0.94, opacity: 0.8 }],
  fan: [{ x: -58, y: 10, rotate: -16, scale: 0.92, opacity: 0.9 }, { x: 0, y: -4, rotate: 0, scale: 1, opacity: 1 }, { x: 58, y: 10, rotate: 16, scale: 0.92, opacity: 0.9 }],
  spread: [{ x: -96, y: 0, rotate: 0, scale: 0.86, opacity: 0.85 }, { x: 0, y: 0, rotate: 0, scale: 0.86, opacity: 1 }, { x: 96, y: 0, rotate: 0, scale: 0.86, opacity: 0.85 }],
  orbit: [{ x: -70, y: -26, rotate: -10, scale: 0.7, opacity: 0.85 }, { x: 0, y: 30, rotate: 0, scale: 0.7, opacity: 0.85 }, { x: 70, y: -26, rotate: 10, scale: 0.7, opacity: 0.85 }],
  lift: [{ x: -40, y: 14, rotate: -8, scale: 0.8, opacity: 0.45 }, { x: 0, y: -10, rotate: 0, scale: 1.12, opacity: 1 }, { x: 40, y: 14, rotate: 8, scale: 0.8, opacity: 0.45 }]
};
/** Before the first pose: low and gathered, so opening shows them rise and take their places. */
const ENTRY: SleevePose = { x: 0, y: 40, rotate: 0, scale: 0.7, opacity: 0 };
const SLEEVES = [
  'linear-gradient(145deg, #ee6b5f, #783e44)',
  'linear-gradient(145deg, var(--wave), #5a6a1e)',
  'linear-gradient(145deg, #7bafd4, #2f4d66)'
] as const;

function SleeveStage({ step, reduced }: { readonly step: TourStep; readonly reduced: boolean }) {
  const travel = reduced ? { duration: 0 } : spring.hero;
  const Icon = step.icon;
  return (
    <div className="info-tour__stage" aria-hidden="true">
      {SLEEVES.map((fill, index) => {
        const pose = POSES[step.pose][index]!;
        return (
          <motion.span
            key={fill}
            className="info-tour__sleeve"
            style={{ background: fill, zIndex: index === 1 ? 2 : 1 }}
            initial={ENTRY}
            animate={pose}
            transition={reduced ? travel : { ...travel, delay: index * motionTokens.stagger }}
          >
            <span className="info-tour__groove" />
          </motion.span>
        );
      })}
      {/* The step's icon on a disc in front: the old one turns away as the new one turns in. */}
      <span className="info-tour__badge">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={step.title}
            className="info-tour__badge-icon"
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: -45 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, rotate: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.5, rotate: 45 }}
            transition={reduced ? { duration: motionTokens.duration.fast } : spring.tactile}
          >
            <Icon size={22} aria-hidden="true" />
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

export function InfoTour({ label, steps, stage, className }: {
  /** The button's name, e.g. "About your library". */
  readonly label: string;
  readonly steps: readonly TourStep[];
  /** A page's own scene in place of the sleeves; it gets the step index. */
  readonly stage?: (index: number, reduced: boolean) => ReactNode;
  readonly className?: string;
}) {
  const reduced = useReducedMotion() ?? false;
  const [open, setOpen] = useState(false);
  // The portal needs document.body, which only exists once mounted in the browser.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const titleId = useId();
  const panel = useRef<HTMLDivElement | null>(null);
  const [button, animateButton] = useAnimate<HTMLButtonElement>();
  const [fold, setFold] = useState<Fold>(null);
  useFocusTrap(open, panel);

  const close = useCallback(() => {
    const from = panel.current?.getBoundingClientRect();
    const to = button.current?.getBoundingClientRect();
    setFold(from && to && to.width > 0
      ? { x: to.left + to.width / 2 - (from.left + from.width / 2), y: to.top + to.height / 2 - (from.top + from.height / 2) }
      : null);
    setOpen(false);
  }, [button]);
  // The "i" catches the folded card: a quick bounce and a ring of light.
  const caught = (): void => {
    if (reduced || !fold || !button.current) return;
    void animateButton(button.current, { scale: [1, 1.32, 0.94, 1] }, { duration: 0.5, ease: motionTokens.ease.emphasis });
    void animateButton('.info-tour__catch', { opacity: [0.9, 0], scale: [0.6, 2.1] }, { duration: 0.6, ease: motionTokens.ease.decelerate });
  };

  const count = steps.length;
  const indexRef = useRef(index); indexRef.current = index;
  const go = (next: number): void => {
    const bounded = Math.max(0, Math.min(count - 1, next));
    setDirection(bounded >= indexRef.current ? 1 : -1);
    setIndex(bounded);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopImmediatePropagation(); close(); return; }
      if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
      event.preventDefault();
      const next = Math.max(0, Math.min(count - 1, indexRef.current + (event.key === 'ArrowRight' ? 1 : -1)));
      setDirection(event.key === 'ArrowRight' ? 1 : -1);
      setIndex(next);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, count, open]);

  if (count === 0) return null;
  const step = steps[Math.min(index, count - 1)]!;
  const last = index === count - 1;
  const lift = reduced ? 0 : 14;
  // Words: the count and title rise first, the line follows a beat later; leaving, they lift away together.
  const word = (order: number) => ({
    initial: { opacity: 0, y: lift * direction },
    animate: { opacity: 1, y: 0, transition: { duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate, delay: reduced ? 0 : 0.08 + order * 0.09 } },
    exit: { opacity: 0, y: -lift * 0.6 * direction, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }
  });

  return (
    <>
      <button ref={button} type="button" className={`info-tour__button${className ? ` ${className}` : ''}`} aria-label={label} aria-haspopup="dialog" title={label} onClick={() => { setIndex(0); setDirection(1); setOpen(true); }}>
        <Info size={18} aria-hidden="true" />
        <span className="info-tour__catch" aria-hidden="true" />
      </button>
      {mounted ? createPortal(<AnimatePresence custom={fold} onExitComplete={caught}>{open ? (
        <motion.div key="tour" className="blend-sheet-layer info-tour__layer">
          <motion.div className="blend-sheet-backdrop" aria-hidden="true" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: motionTokens.duration.slow, ease: motionTokens.ease.standard } }} transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard }} onClick={close} />
          <motion.div
            ref={panel}
            className="blend-sheet info-tour"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            variants={{
              // The card: it waits for the scene's finishing beat, then shrinks straight into the "i" (or sinks, with no "i").
              fold: (to: Fold) => reduced
                ? { opacity: 0, transition: { duration: motionTokens.duration.base } }
                : to
                  ? { x: to.x, y: to.y, scale: 0.06, opacity: [1, 1, 0], transition: { duration: 0.34, delay: 0.24, ease: [0.4, 0, 0.9, 0.55], opacity: { duration: 0.34, delay: 0.24, times: [0, 0.7, 1] } } }
                  : { opacity: 0, y: 12, scale: 0.96, transition: { duration: motionTokens.duration.base, delay: 0.2, ease: motionTokens.ease.accelerate } }
            }}
            exit="fold"
            transition={reduced ? { duration: motionTokens.duration.base } : spring.sheet}
          >
            <motion.button type="button" className="info-tour__close" aria-label="Close" onClick={close} exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast } }}><X size={18} aria-hidden="true" /></motion.button>
            {/* The scene's finishing beat: everything on the stage draws in to its centre (lights merge into one
                glow, sleeves stack, cards gather) and stays lit while the card carries it into the "i". */}
            <motion.div className="info-tour__stage-wrap" exit={reduced ? { opacity: 0 } : { scale: 0.6, transition: { duration: 0.26, ease: motionTokens.ease.emphasis } }}>
              {stage ? stage(index, reduced) : <SleeveStage step={step} reduced={reduced} />}
            </motion.div>
            {/* Words and buttons step aside quickly so the beat reads on its own. */}
            <motion.div className="info-tour__words" aria-live="polite" exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={index} className="info-tour__step">
                  <motion.p className="info-tour__count" {...word(0)}>{count > 1 ? `Step ${index + 1} of ${count}` : label}</motion.p>
                  <motion.h2 id={titleId} className="info-tour__title" {...word(1)}>{step.title}</motion.h2>
                  <motion.p className="info-tour__body" {...word(2)}>{step.body}</motion.p>
                  {step.steps?.length ? (
                    <motion.ol className="info-tour__steps" {...word(3)}>
                      {step.steps.map((item) => <li key={item}>{item}</li>)}
                    </motion.ol>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </motion.div>
            <motion.div className="info-tour__nav" exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}>
              <button type="button" className="spotify-icon-btn" aria-label="Previous" onClick={() => go(index - 1)} disabled={index === 0}><ArrowLeft size={18} aria-hidden="true" /></button>
              <div className="info-tour__dots" role="tablist" aria-label="Steps">
                {steps.map((item, at) => (
                  <button key={item.title} type="button" role="tab" aria-selected={at === index} aria-label={`Step ${at + 1}: ${item.title}`} className="info-tour__dot" onClick={() => go(at)}>
                    {at === index ? <motion.span layoutId={`${titleId}-dot`} className="info-tour__dot-on" transition={reduced ? { duration: 0 } : spring.tactile} /> : null}
                  </button>
                ))}
              </div>
              {last
                ? <button type="button" className="import-spotify-primary info-tour__done" onClick={close}>Got it</button>
                : <button type="button" className="spotify-icon-btn is-primary" aria-label="Next" onClick={() => go(index + 1)}><ArrowRight size={18} aria-hidden="true" /></button>}
            </motion.div>
          </motion.div>
        </motion.div>
      ) : null}</AnimatePresence>, document.body) : null}
    </>
  );
}
