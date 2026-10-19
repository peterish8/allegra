import { useMemo } from 'react';
import { PixelRatio } from 'react-native';
import { usePlayerStore } from '../store/playerStore';
import { usePerformanceTier } from '../utils/performanceTier';
import { useBatterySaver } from '../utils/batterySaver';
import { GLOW_PIXELS_PER_POINT, renderScaleFor, resolveVisualBudget } from '../utils/visualBudget';
import { useAppActive } from './useAppActive';

export interface AmbientBudget {
  /** Shortest wait between redraws, in seconds (0 = every display frame). */
  minStepSeconds: number;
  /** Canvas size as a fraction of its box; scale it back up by 1 / renderScale. */
  renderScale: number;
  /** The same for the glows, which are drawn tiny on every phone (GLOW_PIXELS_PER_POINT). */
  glowScale: number;
  /** false: rest on the last frame. */
  running: boolean;
}

/**
 * The frame cap, canvas density and rest rule for an ambient visual, from the
 * device tier, Battery Saver, playback and AppState foreground visibility.
 * Every shader and glow asks this instead of carrying its own numbers.
 */
export const useVisualBudget = (): AmbientBudget => {
  const playing = usePlayerStore(s => s.isPlaying);
  const batterySaver = useBatterySaver();
  const appActive = useAppActive();
  const tier = usePerformanceTier();
  return useMemo(() => {
    const budget = resolveVisualBudget({ tier, batterySaver, playing, appActive });
    return {
      minStepSeconds: budget.minStepSeconds,
      renderScale: renderScaleFor(budget.pixelsPerPoint, PixelRatio.get()),
      glowScale: renderScaleFor(GLOW_PIXELS_PER_POINT, PixelRatio.get()),
      running: budget.running,
    };
  }, [appActive, batterySaver, playing, tier]);
};
