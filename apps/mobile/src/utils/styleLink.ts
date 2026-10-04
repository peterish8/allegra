/**
 * lyricflow://style?… — set how the app looks from a link. The emulator smoke
 * test uses it to photograph every look without tapping through Settings, and
 * it is shareable ("try this look"). Only the values below are accepted;
 * anything else is ignored, so a link can never write arbitrary settings.
 *
 *   playerBackground=apple|blend|youtube|aura
 *   miniPlayerBackground=glow|tint|glass|black
 *   appBackground=shader|glass|glow
 *   fps=1|0             the frame rate readout
 *   canvas=1|0          the looping cover video (off lets uiautomator read a screen that is never idle)
 */
import type { AppBackground, MiniPlayerBackground, PlayerBackground } from '../store/settingsStore';

export interface StyleUpdates {
  playerBackground?: PlayerBackground;
  miniPlayerBackground?: MiniPlayerBackground;
  appBackground?: AppBackground;
  showPerformanceHUD?: boolean;
  canvasEnabled?: boolean;
}

const PLAYER: readonly PlayerBackground[] = ['apple', 'blend', 'youtube', 'aura'];
const MINI: readonly MiniPlayerBackground[] = ['glow', 'tint', 'glass', 'black'];
const APP: readonly AppBackground[] = ['shader', 'glass', 'glow'];

const pick = <T extends string>(allowed: readonly T[], value: string | undefined): T | undefined =>
  allowed.find(a => a === value);

const flag = (value: string | undefined): boolean | undefined => (value === '1' ? true : value === '0' ? false : undefined);

export const styleUpdates = (params: Record<string, string>): StyleUpdates => {
  const out: StyleUpdates = {};
  const player = pick(PLAYER, params.playerBackground);
  const mini = pick(MINI, params.miniPlayerBackground);
  const app = pick(APP, params.appBackground);
  const fps = flag(params.fps);
  const canvas = flag(params.canvas);
  if (player !== undefined) out.playerBackground = player;
  if (mini !== undefined) out.miniPlayerBackground = mini;
  if (app !== undefined) out.appBackground = app;
  if (fps !== undefined) out.showPerformanceHUD = fps;
  if (canvas !== undefined) out.canvasEnabled = canvas;
  return out;
};
