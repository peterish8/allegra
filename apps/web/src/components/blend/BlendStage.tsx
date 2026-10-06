import { Share2, X } from 'lucide-react';
import { animate, motion, useReducedMotion } from 'motion/react';
import type { TargetAndTransition, Transition } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import type { BlendMemberView } from '@shared/blendView';

import { orbApart, orbReach, orbSeat } from '@shared/blendOrbs';
import { motionTokens, revealTokens, spring } from '../../motion';
import { MatchNumber } from './MatchNumber';

type Phase = 'intro' | 'skipped' | 'settled';

/** Motion animates CSS custom properties; its target type only names standard ones. */
const orbTarget = (opacity: number, travel: number, focus = 1, sink = 0): TargetAndTransition => ({ opacity, '--travel': travel, '--focus': focus, '--sink': sink } as TargetAndTransition);

/** Lens emphasis: the picked person's orb grows a little, everyone else's dims. */
const FOCUS_SCALE = 1.06;
const DIMMED = 0.5;
/** Waiting for a friend: a quiet pool of light behind your orb alone. */
const WAITING_GLOW = 0.3;
/** How far (px) a leaving orb sinks before it is gone. */
const SINK_PX = 22;

/**
 * The Blend as light: one glowing orb per member, overlapping more the closer their taste.
 * Orbs blend with `screen`, so where tastes meet the colour brightens; the match sits in that overlap.
 * A Blend still waiting for its second member shows an empty, dashed orb where the friend will be.
 *
 * `intro` is the reveal, played here rather than in an overlay: the orbs start far apart and spring
 * to the distance their match gives them, a light pool brightens with the overlap, and the number
 * counts up inside it. Skip (or Escape) jumps to the settled frame. Travel is a custom property
 * read by the orb's own transform, so the orbs stay in one blending group the whole way.
 * Reduced motion: no travel; the orbs and number fade in.
 *
 * `focus` is the lens: that member's orb scales up slightly and the others dim. Scale is a custom
 * property for the same reason as travel; reduced motion keeps only the dimming.
 *
 * Waiting for a friend, the invite sits under the ghost orb and the light pools behind yours.
 * `sinking` (a member who just left) sinks that orb back into the light; `pulse` (one per refresh
 * poll) breathes every orb together once. Both are opacity-led; reduced motion keeps only opacity.
 */
export function BlendStage({ members, tones, match, group, intro = false, onIntroDone, focus = null, onInvite, sinking = null, pulse = 0 }: {
  readonly members: readonly BlendMemberView[];
  readonly tones: ReadonlyMap<string, string>;
  readonly match: number | undefined;
  readonly group: boolean;
  readonly intro?: boolean;
  readonly onIntroDone?: () => void;
  readonly focus?: string | null;
  readonly onInvite?: () => void;
  readonly sinking?: string | null;
  readonly pulse?: number;
}) {
  const reduced = useReducedMotion() ?? false;
  const waiting = members.length < 2;
  const [phase, setPhase] = useState<Phase>(intro && !waiting && match !== undefined ? 'intro' : 'settled');
  const done = useRef(onIntroDone);
  done.current = onIntroDone;
  // Fixed at mount: changing it later would restart the count.
  const numberDelay = useRef(phase === 'intro' && !reduced ? revealTokens.numberDelay : 0).current;
  const finish = useRef((next: Phase): void => {
    setPhase((current) => (current === 'intro' ? next : current));
  }).current;

  const started = useRef(phase === 'intro');
  useEffect(() => {
    if (phase === 'intro' || !started.current) return;
    started.current = false;
    done.current?.();
  }, [phase]);

  useEffect(() => {
    if (phase !== 'intro') return undefined;
    // The page below waits on the reveal; never let a stalled animation keep it hidden.
    const fallback = window.setTimeout(() => finish('settled'), revealTokens.maxMs);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      finish('skipped');
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => { window.clearTimeout(fallback); window.removeEventListener('keydown', onKeyDown, true); };
  }, [phase, finish]);

  // A refresh poll landed: the orbs breathe together once, so the wait reads as alive.
  const orbs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (pulse === 0 || !orbs.current) return undefined;
    const breath = animate(orbs.current, { opacity: [1, 0.55, 1] }, { duration: motionTokens.duration.cinematic, ease: motionTokens.ease.standard });
    return () => breath.stop();
  }, [pulse]);

  // 0 when tastes are identical, 1 when they share nothing: how far apart the orbs sit.
  const apart = orbApart(match);
  const reach = orbReach(match);
  const seats = waiting ? 2 : members.length;
  const angle = (index: number): number => (index / seats) * Math.PI * 2 - Math.PI / 2;
  const at = (index: number): { x: number; y: number } => orbSeat(index, seats, reach);
  // Extra distance, in orb widths, an orb travels in from during the intro.
  const travel = (index: number): { dx: number; dy: number } => {
    const extra = Math.max(0, revealTokens.farReach - reach);
    if (seats === 2) return { dx: index === 0 ? -extra : extra, dy: 0 };
    return { dx: Math.cos(angle(index)) * extra, dy: Math.sin(angle(index)) * extra * 0.8 };
  };
  const label = (index: number): { x: number; y: number } => ({ x: Math.cos(angle(index)) * (reach + 0.5), y: Math.sin(angle(index)) * (reach + 0.42) });

  const playing = phase === 'intro';
  const travelling = playing && !reduced;
  // The overlap's light: brighter the closer the tastes.
  const glow = waiting ? WAITING_GLOW : match === undefined ? 0 : 0.25 + 0.55 * (1 - apart);
  const orbTransition: Transition = !travelling
    ? { duration: motionTokens.duration.base, ease: motionTokens.ease.standard }
    : { opacity: { duration: motionTokens.duration.base, ease: motionTokens.ease.standard }, default: { ...spring.hero, delay: revealTokens.travelDelay } };
  // Skip lands the final frame at once. A running animation ignores a new transition when its
  // target is unchanged, so skipping remounts the orbs and glow already at rest instead.
  const skipped = phase === 'skipped';
  const run = skipped ? 'rest' : 'run';

  return (
    <div className={`blend-stage${group ? ' is-group' : ''}${waiting ? ' is-waiting' : ''}${playing ? ' is-intro' : ''}`}>
      <motion.span
        key={run}
        className="blend-stage__glow"
        style={waiting ? ({ '--x': at(0).x } as CSSProperties) : undefined}
        aria-hidden="true"
        initial={{ opacity: travelling ? 0 : glow }}
        animate={{ opacity: glow }}
        transition={{ duration: travelling ? motionTokens.duration.cinematic : 0, ease: motionTokens.ease.decelerate, delay: travelling ? revealTokens.travelDelay : 0 }}
      />
      <div className="blend-stage__orbs" ref={orbs} aria-hidden="true">
        {members.map((member, index) => {
          const { x, y } = at(index);
          const { dx, dy } = travel(index);
          const dimmed = focus !== null && focus !== member.userId;
          const grown = focus === member.userId && !reduced ? FOCUS_SCALE : 1;
          const sunk = sinking === member.userId;
          return (
            <motion.span
              key={`${member.userId}:${run}`}
              className="blend-orb"
              style={{ '--tone': tones.get(member.userId), '--x': x, '--y': y, '--dx': dx, '--dy': dy, '--lag': index } as CSSProperties}
              initial={skipped ? orbTarget(dimmed ? DIMMED : 1, 0, grown) : orbTarget(playing ? 0 : 1, travelling ? 1 : 0)}
              animate={sunk ? orbTarget(0, 0, reduced ? 1 : 0.96, reduced ? 0 : SINK_PX) : orbTarget(dimmed ? DIMMED : 1, 0, grown)}
              transition={orbTransition}
            />
          );
        })}
        {waiting ? <span className="blend-orb is-ghost" style={{ '--x': at(1).x, '--y': 0, '--lag': 1 } as CSSProperties} /> : null}
      </div>

      <div className="blend-stage__center">
        {match !== undefined && !waiting ? (
          <>
            <span className="blend-stage__match"><MatchNumber value={match} delay={numberDelay} instant={phase === 'skipped'} onLanded={() => finish('settled')} /></span>
            <span className="blend-stage__label">{group ? 'group match' : 'taste match'}</span>
          </>
        ) : (
          <h2 className="blend-stage__headline">Waiting for a friend</h2>
        )}
      </div>
      {waiting && onInvite ? (
        <button type="button" className="blend-stage__invite" style={{ '--x': at(1).x } as CSSProperties} onClick={onInvite}>
          <Share2 size={16} aria-hidden="true" /><span>Send invite</span>
        </button>
      ) : null}

      <ul className="blend-stage__names" aria-label="Members">
        {members.map((member, index) => {
          // Pairs: under each orb. Groups: out past each orb, along its direction from the centre.
          const { x, y } = seats === 2 ? at(index) : label(index);
          return (
            <li key={member.userId} style={{ '--tone': tones.get(member.userId), '--x': x, '--y': y } as CSSProperties}>
              {member.isYou ? 'You' : member.displayName}
            </li>
          );
        })}
      </ul>

      {playing ? (
        <button type="button" className="blend-stage__skip" onClick={() => finish('skipped')} aria-label="Skip the reveal">
          <X size={14} aria-hidden="true" /><span>Skip</span>
        </button>
      ) : null}
    </div>
  );
}
