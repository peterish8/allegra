/**
 * The "Glow" app background: two tones of the playing cover (as the website's
 * listening room: primary and secondary) drifting slowly across the top of the
 * screen and fading into plain black (`ROOM_LIGHTS` in edgeGlowMath).
 *
 * Content sits on true black, which is the calmest thing for text and the
 * lightest thing for the battery. With no song playing it is black with a faint
 * neutral glow.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import EdgeGlow from './EdgeGlow';
import { ROOM_LIGHTS } from './edgeGlowMath';
import { NEUTRAL_AURA, type AuraPalette } from './palette';

interface GlowRoomProps {
  /** The playing cover's palette; null with no song. */
  palette: AuraPalette | null;
  /** Screen not visible: the glow stops moving. */
  active?: boolean;
  /** Extra darkening under dense content (0 = none). */
  dim?: number;
}

const GlowRoom: React.FC<GlowRoomProps> = ({ palette, active = true, dim = 0 }) => (
  <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <View style={[StyleSheet.absoluteFill, palette ? null : styles.idle]}>
      <EdgeGlow palette={palette ?? NEUTRAL_AURA} lights={ROOM_LIGHTS} base="#000000" active={active} />
    </View>
    {dim > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${Math.min(0.6, dim * 0.4)})` }]} /> : null}
  </View>
);

const styles = StyleSheet.create({
  idle: { opacity: 0.45 },
});

export default React.memo(GlowRoom);
