import React from 'react';
import { usePlayerStore } from '../../store/playerStore';
import { CoverGlow } from '../../ui/Screen';
import type { AuraMood } from './MusicFlowField';
import type { AuraPalette } from './palette';
interface DynamicAuraProps { palette: AuraPalette; playing?: boolean; active?: boolean; mood?: AuraMood; dim?: number }
/** Compatibility adapter: V6 always uses one static top-cover glow. */
export const DynamicAura: React.FC<DynamicAuraProps> = React.memo(() => {
  const uri = usePlayerStore(s => s.currentSong?.coverImageUri ?? s.currentSong?.coverRemoteUri);
  return <CoverGlow uri={uri} />;
});
export const PlayingAura = DynamicAura;
export default DynamicAura;
