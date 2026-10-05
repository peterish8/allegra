import { MusicFlowShader } from './shader/MusicFlowShader';
import type { Palette } from '../lib/palette';
import type { AppBackground } from '../lib/settings';
import type { CSSProperties } from 'react';

/**
 * Shared ambient field. Slow time-based drift only — no beat sync.
 */
export function DynamicAura({ paused = false, energy = 0.48, mood = 'energy', palette = null, variant = 'shader' }: { readonly paused?: boolean; readonly energy?: number; readonly mood?: 'energy' | 'chill' | 'different' | 'surprise'; readonly palette?: Palette | null; readonly variant?: AppBackground }) {
  const auraStyle = {
    '--aura-primary': palette?.primary ?? '#ee6b5f',
    '--aura-secondary': palette?.secondary ?? '#7bafd4',
    '--aura-tertiary': palette?.tertiary ?? '#c4dd74'
  } as CSSProperties;

  // The phone's Glow: two drifting glows in the cover's colours across the top third, melting into black.
  if (variant === 'glow') {
    return (
      <div className={`dynamic-aura dynamic-aura--glow ${paused ? 'is-paused' : ''}`} style={auraStyle} aria-hidden="true">
        <div className="glow-room">
          <i className="glow-room__blob glow-room__blob--a" />
          <i className="glow-room__blob glow-room__blob--b" />
        </div>
      </div>
    );
  }

  return (
    <div className={`dynamic-aura ${paused ? 'is-paused' : ''}`} style={auraStyle} aria-hidden="true">
      <MusicFlowShader energy={paused ? 0.12 : energy} mood={mood} palette={palette} />
      <div className="vibe-flutes" />
      <div className="vibe-vignette" />
      <div className="vibe-scrim" />
    </div>
  );
}
