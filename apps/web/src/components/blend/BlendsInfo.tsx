'use client';

/**
 * The "i" beside the Blends title, on the shared InfoTour, with Blends' own stage.
 *
 * One set of colour lights (the Blend's identity, as on the Blend page) orbits on a tilted circle the whole time
 * and changes pose per step: two lights drift together (what a Blend is), a ring turns round them
 * (fresh every day), a third light joins the orbit (friends), and a playlist's songs stream up into
 * the light (your Spotify feeds it). The words swap with each step: the old lines lift
 * out, the new ones rise in one after another. Next, Back, the dots and the arrow keys work at once;
 * the lights retarget from wherever they are, so quick taps never jump.
 *
 * Transform and opacity only. Reduced motion: no orbit, no streaming songs; the lights take each pose
 * at once and the playlist card simply appears.
 */
import { animate, AnimatePresence, motion, useMotionValue, useTime, useTransform } from 'motion/react';
import { useEffect } from 'react';
import { Download, Heart, RefreshCw, UserPlus, Users } from 'lucide-react';

import { BLEND_MAX_MEMBERS } from '@shared/blendLimits';

import { motionTokens, spring } from '../../motion';
import { InfoTour, type TourStep } from '../InfoTour';

/** The sleeves' icon and pose are unused here: Blends draws its own lights (Stage). */
const STEPS: readonly TourStep[] = [
  { title: 'One playlist, two tastes', body: 'A Blend mixes what you love with what a friend loves into one shared playlist.', icon: Users, pose: 'stack' },
  { title: 'Fresh every day', body: 'It rebuilds each day from what you both play and like, so it keeps up with you.', icon: RefreshCw, pose: 'stack' },
  { title: 'Bring your friends', body: `Send an invite link. Up to ${BLEND_MAX_MEMBERS} people can share one Blend.`, icon: UserPlus, pose: 'stack' },
  { title: 'Your Spotify counts', body: 'Move your Liked Songs and playlists over here, and your Blends learn from them too.', icon: Download, pose: 'stack' }
];

/**
 * Each light's place in the orbit per step: radius from the centre, its angle on the circle, a lift and
 * a size. `null`: off stage. Two lights sit opposite each other; three share the circle a third apart.
 */
type Orbit = { readonly r: number; readonly phase: number; readonly y: number; readonly scale: number };
const TURN = Math.PI * 2;
const POSES: readonly (readonly (Orbit | null)[])[] = [
  [{ r: 40, phase: 0, y: 0, scale: 1 }, { r: 40, phase: TURN / 2, y: 0, scale: 1 }, null],
  [{ r: 28, phase: 0, y: 0, scale: 1.05 }, { r: 28, phase: TURN / 2, y: 0, scale: 1.05 }, null],
  [{ r: 44, phase: 0, y: 4, scale: 0.88 }, { r: 44, phase: TURN / 3, y: 4, scale: 0.88 }, { r: 44, phase: (TURN * 2) / 3, y: 4, scale: 0.88 }],
  [{ r: 28, phase: 0, y: -24, scale: 0.92 }, { r: 28, phase: TURN / 2, y: -24, scale: 0.92 }, null]
];
/** Before a light's first pose: wide and small, so opening shows them drawing in. */
const APART: readonly Orbit[] = [{ r: 110, phase: 0, y: 0, scale: 0.7 }, { r: 110, phase: TURN / 2, y: 0, scale: 0.7 }, { r: 110, phase: (TURN * 2) / 3, y: 4, scale: 0.6 }];
/** One full turn of the orbit. */
const ORBIT_MS = 9000;
/** How far the orbit plane leans towards you: the near light sits a little lower and larger. */
const TILT = 0.3;
const DEPTH_SCALE = 0.16;

/**
 * One light on the orbit. Its pose (radius, angle, lift, size) springs between steps; the orbit angle
 * comes from the clock. Position, size and lift are worked out from both every frame, so the lights pass
 * in front of and behind each other smoothly: they add together as light (screen blend), so it never
 * matters which is drawn on top.
 */
function OrbitLight({ colour, pose, apart, reduced }: { readonly colour: string; readonly pose: Orbit | null; readonly apart: Orbit; readonly reduced: boolean }) {
  const target = pose ?? apart;
  const r = useMotionValue(apart.r);
  const phase = useMotionValue(apart.phase);
  const lift = useMotionValue(apart.y);
  const size = useMotionValue(apart.scale);
  const opacity = useMotionValue(0);
  useEffect(() => {
    const settle = reduced ? { duration: 0 } : spring.hero;
    const runs = [
      animate(r, target.r, settle), animate(phase, target.phase, settle), animate(lift, target.y, settle), animate(size, target.scale, settle),
      animate(opacity, pose ? 0.92 : 0, reduced ? { duration: motionTokens.duration.fast } : { duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate })
    ];
    return () => runs.forEach((run) => run.stop());
  }, [lift, opacity, phase, pose, r, reduced, size, target.phase, target.r, target.scale, target.y]);
  const time = useTime();
  const angle = useTransform(() => (reduced ? 0 : (time.get() / ORBIT_MS) * TURN) + phase.get());
  const x = useTransform(() => r.get() * Math.cos(angle.get()));
  const y = useTransform(() => lift.get() + r.get() * Math.sin(angle.get()) * TILT);
  const scale = useTransform(() => size.get() * (1 + DEPTH_SCALE * Math.sin(angle.get()) * Math.min(1, r.get() / 40)));
  return <motion.span className="blends-info__light" style={{ background: colour, x, y, scale, opacity }} />;
}

const LIGHTS = ['var(--wave)', '#ee6b5f', '#7bafd4'] as const;
/** Step 4: songs leave the playlist card and curve up into the light. Start x and bend per song. */
const STREAM = [
  { x: -34, bend: -46 }, { x: 18, bend: 40 }, { x: -6, bend: -24 }, { x: 30, bend: 52 },
  { x: -22, bend: 30 }, { x: 8, bend: -40 }, { x: -40, bend: 18 }
] as const;

function Stage({ step, reduced }: { readonly step: number; readonly reduced: boolean }) {
  return (
    <div className="blends-info__stage" aria-hidden="true">
      {/* Fresh every day: a slow ring round the lights, with one bright point riding it. */}
      <motion.span
        className="blends-info__ring"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: step === 1 ? 1 : 0, scale: step === 1 ? 1 : 0.8 }}
        transition={reduced ? { duration: motionTokens.duration.fast } : { duration: motionTokens.duration.slow, ease: motionTokens.ease.decelerate }}
      >
        <span className={`blends-info__ring-turn${reduced ? '' : ' is-turning'}`} />
      </motion.span>

      {/* The lights orbit each other on a tilted circle: the near one grows and drops a little, the far
          one shrinks, and where they cross their colours mix. */}
      {LIGHTS.map((colour, index) => (
        <OrbitLight key={colour} colour={colour} pose={POSES[step]?.[index] ?? null} apart={APART[index]!} reduced={reduced} />
      ))}

      {/* Your Spotify counts: a playlist rises in below, and its songs stream up into the light. */}
      <AnimatePresence>
        {step === 3 ? (
          <motion.span
            key="playlist"
            className="blends-info__playlist"
            initial={reduced ? { opacity: 0, y: 58 } : { opacity: 0, y: 96, scale: 0.92 }}
            animate={{ opacity: 1, y: 58, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 58 : 80, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
            transition={reduced ? { duration: motionTokens.duration.base } : spring.sheet}
          >
            <span className="blends-info__playlist-art"><Heart size={14} fill="currentColor" /></span>
            <span className="blends-info__playlist-lines"><span /><span /></span>
          </motion.span>
        ) : null}
        {step === 3 && !reduced ? STREAM.map((song, index) => (
          <motion.span
            key={`song-${index}`}
            className="blends-info__song"
            style={{ background: LIGHTS[index % 2], color: LIGHTS[index % 2] }}
            initial={{ opacity: 0, x: song.x, y: 50, scale: 0.4 }}
            animate={{
              opacity: [0, 1, 1, 0],
              x: [song.x, song.x + song.bend, song.bend * 0.35, 0],
              y: [50, 24, -6, -24],
              scale: [0.4, 1, 0.85, 0.2]
            }}
            exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast } }}
            transition={{ duration: 1.5, ease: motionTokens.ease.standard, times: [0, 0.3, 0.72, 1], delay: 0.35 + index * 0.22, repeat: Infinity, repeatDelay: 0.5 }}
          />
        )) : null}
      </AnimatePresence>
    </div>
  );
}

export function BlendsInfo() {
  return <InfoTour label="What is a Blend?" steps={STEPS} stage={(index, reduced) => <Stage step={index} reduced={reduced} />} />;
}
