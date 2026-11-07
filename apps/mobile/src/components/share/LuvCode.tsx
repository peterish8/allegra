/**
 * A LuvLyrics code (packages/shared/luvCode.ts): the mark and 25 rounded bars, white on a calm tone of the cover.
 * The website draws the same layout, so a code scanned from a screen or a printout reads the same.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { CODE_HEIGHT, CODE_WIDTH, encodeLuvCode, luvCodeLayout, type LuvCodePayload } from '@shared/luvCode';
import { Signal } from '../../constants/allegraTheme';

interface Props {
  payload: LuvCodePayload;
  /** The card's colour: dark enough that white bars read on it (pillTint of the cover). */
  tint: string;
  width: number;
  label: string;
  style?: StyleProp<ViewStyle>;
}

export const LuvCode: React.FC<Props> = ({ payload, tint, width, label, style }) => {
  const levels = encodeLuvCode(payload);
  if (!levels) return null;
  const layout = luvCodeLayout(levels);
  const height = (width * CODE_HEIGHT) / CODE_WIDTH;
  return (
    <View style={style} accessible accessibilityRole="image" accessibilityLabel={`LuvLyrics code for ${label}. Someone can scan it with LuvLyrics to open it.`}>
      <Svg width={width} height={height} viewBox={`0 0 ${CODE_WIDTH} ${CODE_HEIGHT}`}>
        <Rect width={CODE_WIDTH} height={CODE_HEIGHT} rx={14} fill={tint} />
        <Circle cx={layout.mark.cx} cy={layout.mark.cy} r={layout.mark.r} fill={Signal.ink} />
        <Path d={layout.mark.heart} fill={tint} />
        {layout.bars.map((bar, i) => (
          <Rect key={i} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={bar.width / 2} fill={Signal.ink} />
        ))}
      </Svg>
    </View>
  );
};
