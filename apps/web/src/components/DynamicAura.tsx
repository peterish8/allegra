import { MusicFlowShader } from './shader/MusicFlowShader';
import type { Palette } from '../lib/palette';
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { useAudioAnalyser } from '../hooks/useAudioAnalyser';

/**
 * The glow field gets a small, smoothed response from the local audio output.
 */
function GlowAurora({ audioRef, audioActive, paused }: { readonly audioRef: RefObject<HTMLAudioElement | null>; readonly audioActive: boolean; readonly paused: boolean }) {
  const reducedMotion = useReducedMotion();
  const firstCoreRef = useRef<HTMLDivElement | null>(null);
  const secondCoreRef = useRef<HTMLDivElement | null>(null);
  const analyser = useAudioAnalyser(audioRef, audioActive && !paused && !reducedMotion);

  useEffect(() => {
    if (!audioActive || paused || reducedMotion) return undefined;
    let frame = 0;
    const animate = (): void => {
      const level = analyser.readLevel();
      const response = Math.min(0.16, level * 0.5);
      if (firstCoreRef.current) {
        firstCoreRef.current.style.transform = `translate3d(0, ${-response * 36}px, 0) scale(${1 + response})`;
      }
      if (secondCoreRef.current) {
        secondCoreRef.current.style.transform = `translate3d(0, ${response * 30}px, 0) scale(${1 + response * 0.82})`;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frame);
      if (firstCoreRef.current) firstCoreRef.current.style.transform = '';
      if (secondCoreRef.current) secondCoreRef.current.style.transform = '';
    };
  }, [analyser, audioActive, paused, reducedMotion]);

  return (
    <div className="glow-room">
      <div className="glow-room__blob glow-room__blob--first"><div ref={firstCoreRef} className="glow-room__core glow-room__core--first" /></div>
      <div className="glow-room__blob glow-room__blob--second"><div ref={secondCoreRef} className="glow-room__core glow-room__core--second" /></div>
    </div>
  );
}

export function DynamicAura({ paused = false, energy = 0.48, mood = 'energy', palette = null, variant = 'shader', audioRef, audioActive = false }: {
  readonly paused?: boolean;
  readonly energy?: number;
  readonly mood?: 'energy' | 'chill' | 'different' | 'surprise';
  readonly palette?: Palette | null;
  readonly variant?: 'shader' | 'glow';
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly audioActive?: boolean;
}) {
  const idleGlow = variant === 'glow' && palette === null;
  const auraStyle = {
    '--aura-primary': palette?.primary ?? (idleGlow ? '#282828' : '#ee6b5f'),
    '--aura-secondary': palette?.secondary ?? (idleGlow ? '#282828' : '#7bafd4'),
    '--aura-tertiary': palette?.tertiary ?? (idleGlow ? '#282828' : '#c4dd74')
  } as CSSProperties;

  return (
    <div className={`dynamic-aura ${variant === 'glow' ? 'dynamic-aura--glow' : ''} ${paused ? 'is-paused' : ''}`} style={auraStyle} aria-hidden="true">
      {variant === 'glow'
        ? <GlowAurora audioRef={audioRef} audioActive={audioActive} paused={paused} />
        : <MusicFlowShader energy={paused ? 0.12 : energy} mood={mood} palette={palette} />}
      <div className="vibe-flutes" />
      <div className="vibe-vignette" />
      <div className="vibe-scrim" />
    </div>
  );
}
