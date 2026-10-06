/**
 * The Blend as light, on the phone: one glowing orb per member, overlapping more the closer their
 * taste (seats from @shared/blendOrbs, the same as the website). Orbs blend with `screen` in Skia, so
 * where tastes meet the colour brightens and the match sits in that overlap.
 *
 * `intro` is the reveal, played here rather than over the page: the orbs start far apart and spring
 * to their match distance, a light pool rises, the number counts up. Tap Skip to land at once.
 * `focus` is the lens: that member's orb grows a little and the others dim. Waiting for a friend,
 * an outlined ghost orb breathes where they will be and the invite sits under it.
 * Reduced motion: no travel or drift, fades only. Transform and opacity only; nothing ticks off screen.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Canvas, Circle, DashPathEffect, Group, RadialGradient, vec } from '@shopify/react-native-skia';
import { cancelAnimation, useDerivedValue, useReducedMotion, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type SharedValue } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';

import { orbApart, orbReach, orbSeat } from '@shared/blendOrbs';
import type { BlendMemberView } from '@shared/blendView';
import { Motion, Signal } from '../../constants/allegraTheme';
import { discColour } from './BlendParts';
import { tapHaptic } from './stageHaptics';

/** The reveal's timing, the website's revealTokens. */
export const REVEAL = { farReach: 0.95, travelDelayMs: 80, numberDelayMs: 400, maxMs: 3000 } as const;
const FOCUS_SCALE = 1.06;
const DIMMED = 0.5;
const DRIFT_MS = 9000;

const alpha = (hex: string, a: number): string => `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}`;

const Orb: React.FC<{
  readonly colour: string;
  readonly size: number;
  readonly centre: { readonly x: number; readonly y: number };
  readonly seat: { readonly x: number; readonly y: number };
  readonly far: { readonly dx: number; readonly dy: number };
  readonly lag: number;
  readonly travel: SharedValue<number>;
  readonly appear: SharedValue<number>;
  readonly drift: SharedValue<number>;
  readonly dimmed: boolean;
  readonly grown: boolean;
}> = ({ colour, size, centre, seat, far, lag, travel, appear, drift, dimmed, grown }) => {
  const reduce = useReducedMotion();
  const light = useSharedValue(dimmed ? DIMMED : 1);
  const scale = useSharedValue(grown && !reduce ? FOCUS_SCALE : 1);
  useEffect(() => { light.value = withTiming(dimmed ? DIMMED : 1, { duration: Motion.duration.base, easing: Motion.ease.standard }); }, [dimmed, light]);
  useEffect(() => { scale.value = withTiming(grown && !reduce ? FOCUS_SCALE : 1, { duration: Motion.duration.base, easing: Motion.ease.standard }); }, [grown, reduce, scale]);
  const c = useDerivedValue(() => {
    const d = lag % 2 === 0 ? drift.value : 1 - drift.value;
    return vec(centre.x + (seat.x + far.dx * travel.value) * size + d * 10, centre.y + (seat.y + far.dy * travel.value) * size - d * 12);
  });
  const r = useDerivedValue(() => (size / 2) * scale.value * (1 + 0.05 * drift.value));
  const opacity = useDerivedValue(() => light.value * appear.value);
  return (
    <Circle c={c} r={r} blendMode="screen" opacity={opacity}>
      <RadialGradient c={c} r={r} colors={[colour, alpha(colour, 0.82), alpha(colour, 0.34), alpha(colour, 0)]} positions={[0, 0.42, 0.72, 1]} />
    </Circle>
  );
};

/** The match counting up from 0 once the overlap has begun to form; the final number at once otherwise. */
const MatchCount: React.FC<{ value: number; play: boolean; skipped: boolean; onLanded: () => void }> = ({ value, play, skipped, onLanded }) => {
  const [shown, setShown] = useState(play ? 0 : value);
  const landed = useRef(onLanded);
  landed.current = onLanded;
  useEffect(() => {
    if (!play || skipped) { setShown(value); landed.current(); return undefined; }
    let frame = 0;
    const start = Date.now() + REVEAL.numberDelayMs;
    const step = (): void => {
      const t = Math.min(1, Math.max(0, (Date.now() - start) / Motion.duration.cinematic));
      // emphasis-like ease out
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) frame = requestAnimationFrame(step);
      else { tapHaptic(); landed.current(); }
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [play, skipped, value]);
  return <Text style={styles.match} accessible={false}>{shown}%</Text>;
};

export const BlendStage: React.FC<{
  readonly members: readonly BlendMemberView[];
  readonly match: number | undefined;
  readonly group: boolean;
  readonly intro?: boolean;
  readonly onIntroDone?: () => void;
  readonly focus?: string | null;
  readonly onInvite?: () => void;
  /** Bump to breathe the orbs once (a refresh landed). */
  readonly pulse?: number;
}> = ({ members, match, group, intro = false, onIntroDone, focus = null, onInvite, pulse = 0 }) => {
  const reduce = useReducedMotion();
  const waiting = members.length < 2;
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState<'intro' | 'skipped' | 'settled'>(intro && !waiting && match !== undefined ? 'intro' : 'settled');
  const playing = phase === 'intro';
  const travelling = playing && !reduce;

  const travel = useSharedValue(travelling ? 1 : 0);
  const appear = useSharedValue(playing ? 0 : 1);
  const drift = useSharedValue(0);
  const breath = useSharedValue(1);
  const ghost = useSharedValue(0.45);

  const done = useRef(onIntroDone);
  done.current = onIntroDone;
  const finish = useCallback((next: 'skipped' | 'settled') => {
    setPhase((current) => (current === 'intro' ? next : current));
  }, []);
  // Tell the screen once, after the reveal has landed (or been skipped).
  const started = useRef(phase === 'intro');
  useEffect(() => {
    if (phase === 'intro' || !started.current) return;
    started.current = false;
    done.current?.();
  }, [phase]);

  useEffect(() => {
    if (phase === 'intro') {
      appear.value = withTiming(1, { duration: Motion.duration.base, easing: Motion.ease.standard });
      if (!reduce) travel.value = withDelay(REVEAL.travelDelayMs, withSpring(0, Motion.spring.hero));
      // The page below waits on the reveal; never let a stalled animation keep it waiting.
      const fallback = setTimeout(() => finish('settled'), REVEAL.maxMs);
      return () => clearTimeout(fallback);
    }
    if (phase === 'skipped') { cancelAnimation(travel); travel.value = 0; cancelAnimation(appear); appear.value = 1; }
    return undefined;
  }, [phase, reduce, appear, travel, finish]);

  // Ambient drift and the ghost's breathing: off under Reduce Motion, stopped on unmount.
  useEffect(() => {
    if (reduce) return undefined;
    drift.value = withRepeat(withTiming(1, { duration: DRIFT_MS, easing: Motion.ease.standard }), -1, true);
    ghost.value = withRepeat(withTiming(0.6, { duration: DRIFT_MS / 2, easing: Motion.ease.standard }), -1, true);
    return () => { cancelAnimation(drift); cancelAnimation(ghost); };
  }, [reduce, drift, ghost]);

  useEffect(() => {
    if (pulse === 0) return;
    breath.value = withSequence(withTiming(0.55, { duration: Motion.duration.cinematic / 2 }), withTiming(1, { duration: Motion.duration.cinematic / 2 }));
  }, [pulse, breath]);

  const orb = Math.max(140, Math.min(group ? 200 : 240, width * (group ? 0.36 : 0.46)));
  const height = Math.round(orb * (group ? 1.6 : 1.3) + (waiting ? 24 : 0));
  const centre = { x: width / 2, y: (group ? orb * 1.6 : orb * 1.3) / 2 };
  const reach = orbReach(match);
  const seats = waiting ? 2 : members.length;
  const extra = Math.max(0, REVEAL.farReach - reach);
  const far = (index: number) => {
    const seat = orbSeat(index, seats, 1);
    const length = Math.hypot(seat.x, seat.y / 0.8) || 1;
    return { dx: (seat.x / length) * extra, dy: (seat.y / length) * extra * 0.8 };
  };
  const glowTarget = waiting ? 0.3 : match === undefined ? 0 : 0.25 + 0.55 * (1 - orbApart(match));
  const glow = useSharedValue(travelling ? 0 : glowTarget);
  useEffect(() => {
    glow.value = travelling ? withDelay(REVEAL.travelDelayMs, withTiming(glowTarget, { duration: Motion.duration.cinematic, easing: Motion.ease.decelerate })) : glowTarget;
  }, [glow, glowTarget, travelling]);
  const glowAlpha = useDerivedValue(() => glow.value * breath.value);
  const groupOpacity = useDerivedValue(() => breath.value);
  const glowCentre = waiting ? vec(centre.x + orbSeat(0, 2, reach).x * orb, centre.y) : vec(centre.x, centre.y);
  const ghostSeat = orbSeat(1, 2, reach);

  const onLayout = (event: LayoutChangeEvent): void => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next !== width) setWidth(next);
  };

  return (
    <View style={[styles.stage, { height }]} onLayout={onLayout}>
      {width > 0 ? (
        <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
          <Circle c={glowCentre} r={orb * 0.75} opacity={glowAlpha}>
            <RadialGradient c={glowCentre} r={orb * 0.75} colors={['rgba(255,255,255,0.34)', 'rgba(255,255,255,0.08)', 'rgba(255,255,255,0)']} positions={[0, 0.55, 1]} />
          </Circle>
          <Group opacity={groupOpacity}>
            {members.map((member, index) => (
              <Orb
                key={member.userId}
                colour={discColour(member.userId)}
                size={orb}
                centre={centre}
                seat={orbSeat(index, seats, reach)}
                far={far(index)}
                lag={index}
                travel={travel}
                appear={appear}
                drift={drift}
                dimmed={focus !== null && focus !== member.userId}
                grown={focus === member.userId}
              />
            ))}
          </Group>
          {waiting ? (
            <Circle c={vec(centre.x + ghostSeat.x * orb, centre.y)} r={orb * 0.35} style="stroke" strokeWidth={2} color="rgba(255,255,255,0.32)" opacity={ghost}>
              <DashPathEffect intervals={[8, 8]} />
            </Circle>
          ) : null}
        </Canvas>
      ) : null}

      <View style={[styles.centre, { top: centre.y - 60 }]} pointerEvents="none">
        {match !== undefined && !waiting ? (
          <>
            <MatchCount value={match} play={playing} skipped={phase === 'skipped'} onLanded={() => finish('settled')} />
            <Text style={styles.label}>{group ? 'group match' : 'taste match'}</Text>
          </>
        ) : <Text style={styles.headline} accessibilityRole="header">Waiting for a friend</Text>}
      </View>
      <Text style={styles.srOnly} accessibilityLiveRegion="polite">{match !== undefined && !waiting ? `${group ? 'Group' : 'Taste'} match ${match} percent` : ''}</Text>

      {width > 0 ? members.map((member, index) => {
        const seat = seats === 2 ? orbSeat(index, 2, reach) : orbSeat(index, seats, reach + 0.5);
        const y = seats === 2 ? centre.y + orb * 0.44 : centre.y + seat.y * orb - 14;
        return (
          <View key={member.userId} pointerEvents="none" style={[styles.name, { left: centre.x + seat.x * orb - 60, top: y }]}>
            <View style={[styles.nameDot, { backgroundColor: discColour(member.userId) }]} />
            <Text style={styles.nameText} numberOfLines={1}>{member.isYou ? 'You' : member.displayName}</Text>
          </View>
        );
      }) : null}

      {waiting && onInvite && width > 0 ? (
        <Pressable onPress={onInvite} accessibilityRole="button" accessibilityLabel="Send invite" style={[styles.invite, { left: centre.x + ghostSeat.x * orb - 70, top: centre.y + orb * 0.44 - 8 }]}>
          <Ionicons name="share-outline" size={16} color={Signal.waveInk} />
          <Text style={styles.inviteText}>Send invite</Text>
        </Pressable>
      ) : null}

      {playing ? (
        <Pressable onPress={() => finish('skipped')} accessibilityRole="button" accessibilityLabel="Skip the reveal" hitSlop={8} style={styles.skip}>
          <Ionicons name="close" size={14} color={Signal.ink} />
          <Text style={styles.skipText}>Skip</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  stage: { width: '100%' },
  centre: { position: 'absolute', left: 0, right: 0, height: 120, alignItems: 'center', justifyContent: 'center' },
  match: { color: '#fff', fontSize: 72, fontWeight: '800', fontVariant: ['tabular-nums'], textShadowColor: 'rgba(0,0,0,0.35)', textShadowRadius: 24 },
  label: { color: 'rgba(255,255,255,0.82)', fontSize: 14, fontWeight: '600' },
  headline: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  srOnly: { position: 'absolute', width: 1, height: 1, opacity: 0 },
  name: { position: 'absolute', width: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  nameDot: { width: 8, height: 8, borderRadius: 4 },
  nameText: { color: '#fff', fontSize: 13, fontWeight: '600', maxWidth: 100, textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 8 },
  invite: { position: 'absolute', width: 140, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Signal.wave },
  inviteText: { color: Signal.waveInk, fontSize: 14, fontWeight: '800' },
  skip: { position: 'absolute', top: 0, right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  skipText: { color: Signal.ink, fontSize: 13, fontWeight: '600' },
});
