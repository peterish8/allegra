/**
 * The cover glow: black through the middle, two tones of the cover pouring in
 * at an angle from the edges and drifting slowly (`edgeGlowMath` places them).
 * The player's "Cover glow" background uses top and bottom lights; the app's
 * "Glow" background uses two tones across the top only.
 *
 * Drawn with Skia: each light is one radial gradient stretched into a shallow,
 * tilted ellipse, so only transforms and two colours change per frame. The frame
 * cap, density and rest rule come from the visual budget; it stops when `active`
 * is false, and holds still under Reduce Motion (the colours still follow the song).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Canvas, Fill, Group, RadialGradient, Rect, vec } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import type { FrameInfo, SharedValue } from 'react-native-reanimated';
import { useVisualBudget } from '../../hooks/useVisualBudget';
import { Motion } from '../../constants/allegraTheme';
import { rgba } from '../player/glowMath';
import { hexToRgb, type AuraPalette } from './palette';
import { lightPose, type EdgeLight, type GlowTone } from './edgeGlowMath';

const TONES: readonly GlowTone[] = ['primary', 'secondary', 'tertiary'];
/** The unit gradient every light stretches; colour fades to nothing at its rim. */
const STOPS = [0, 0.46, 1];
const ORIGIN = vec(0, 0);

/** The palette as 0..255 channels, in `TONES` order, for the UI thread. */
const toChannels = (p: AuraPalette): number[][] => TONES.map(tone => hexToRgb(p[tone]).map(v => v * 255));

interface LightProps {
  light: EdgeLight;
  /** The canvas size in pixels (after any render scale). */
  width: number;
  height: number;
  /** Seconds of drift so far. */
  time: SharedValue<number>;
  /** The previous and next palettes, and how far the cross-fade between them has run (0..1). */
  from: SharedValue<number[][]>;
  to: SharedValue<number[][]>;
  mix: SharedValue<number>;
}

const Light: React.FC<LightProps> = ({ light, width, height, time, from, to, mix }) => {
  const tone = TONES.indexOf(light.tone);
  const transform = useDerivedValue(() => {
    const pose = lightPose(light, time.value, width, height);
    return [{ translateX: pose.cx }, { translateY: pose.cy }, { rotate: pose.rotate }, { scaleX: pose.rx }, { scaleY: pose.ry }];
  });
  const colors = useDerivedValue(() => {
    const next = to.value[tone] ?? [40, 40, 40];
    const prev = from.value[tone] ?? next;
    const m = mix.value;
    const c = [prev[0] + (next[0] - prev[0]) * m, prev[1] + (next[1] - prev[1]) * m, prev[2] + (next[2] - prev[2]) * m];
    return [rgba(c, light.alpha), rgba(c, light.alpha * 0.42), rgba(c, 0)];
  });
  return (
    <Group transform={transform}>
      <Rect x={-1} y={-1} width={2} height={2}>
        <RadialGradient c={ORIGIN} r={1} colors={colors} positions={STOPS} />
      </Rect>
    </Group>
  );
};

interface EdgeGlowProps {
  /** The cover's colours; a change cross-fades in. */
  palette: AuraPalette;
  /** Where the lights sit and how they move (`PLAYER_LIGHTS` or `ROOM_LIGHTS`). */
  lights: readonly EdgeLight[];
  /** The black the lights sit on. */
  base: string;
  /** Screen visible; the loop stops otherwise. */
  active?: boolean;
}

const EdgeGlow: React.FC<EdgeGlowProps> = ({ palette, lights, base, active = true }) => {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (Math.round(width) !== Math.round(size.width) || Math.round(height) !== Math.round(size.height)) setSize({ width, height });
  };

  // A new song's colours ease in over the last ones.
  const channels = useMemo(() => toChannels(palette), [palette]);
  const from = useSharedValue<number[][]>(channels);
  const to = useSharedValue<number[][]>(channels);
  const mix = useSharedValue(1);
  useEffect(() => {
    from.value = to.value;
    to.value = channels;
    mix.value = 0;
    mix.value = withTiming(1, { duration: Motion.duration.crossfade, easing: Motion.ease.standard });
  }, [channels, from, to, mix]);

  const budget = useVisualBudget();
  const reduce = useReducedMotion();
  const minStep = useSharedValue(budget.minStepSeconds);
  useEffect(() => {
    minStep.value = budget.minStepSeconds;
  }, [budget.minStepSeconds, minStep]);
  const time = useSharedValue(0);
  const pending = useSharedValue(0);
  const tick = useCallback((info: FrameInfo) => {
    'worklet';
    pending.value += Math.min(info.timeSincePreviousFrame ?? 16, 66) / 1000;
    if (pending.value < minStep.value) return;
    time.value += pending.value;
    pending.value = 0;
  }, [minStep, pending, time]);
  const frame = useFrameCallback(tick, false);
  const running = active && budget.running && !reduce;
  useEffect(() => {
    frame.setActive(running);
  }, [running, frame]);

  const { width, height } = size;
  // Soft gradients: drawn tiny and scaled up, like the island's light (GLOW_PIXELS_PER_POINT).
  const scale = budget.glowScale;
  const cw = Math.max(1, Math.round(width * scale));
  const ch = Math.max(1, Math.round(height * scale));
  return (
    <View style={[StyleSheet.absoluteFill, styles.clip, { backgroundColor: base }]} pointerEvents="none" onLayout={onLayout}>
      {width > 0 && height > 0 ? (
        // The transform lives on a wrapper: Skia's Canvas doesn't forward it on every platform.
        <View style={{ width: cw, height: ch, transform: [{ translateX: (width - cw) / 2 }, { translateY: (height - ch) / 2 }, { scale: 1 / scale }] }}>
          <Canvas style={{ width: cw, height: ch }}>
            <Fill color={base} />
            {lights.map((light, i) => (
              <Light key={i} light={light} width={cw} height={ch} time={time} from={from} to={to} mix={mix} />
            ))}
          </Canvas>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});

export default React.memo(EdgeGlow);
