import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { Surface } from '../constants/allegraTheme';
import { useLowEndDevice } from '../utils/performanceTier';
import { useBatterySaver } from '../utils/batterySaver';

/** Only the cover bitmap is blurred. Content scrolling behind it never participates. */
export const ShellMaterial: React.FC<{ uri?: string }> = ({ uri }) => {
  const low = useLowEndDevice();
  const [reduce, setReduce] = useState(false);
  const powerSave = useBatterySaver();
  useEffect(() => {
    const refresh = () => {
      AccessibilityInfo.isReduceTransparencyEnabled().then(setReduce).catch(() => undefined);
    };
    refresh();
    const transparency = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    const app = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { transparency.remove(); app.remove(); };
  }, []);
  const solid = low || reduce || powerSave || !uri;
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
    {!solid ? <Image source={{ uri, width: 48, height: 48 }} blurRadius={30} contentFit="cover" style={StyleSheet.absoluteFill} /> : null}
    <View style={[StyleSheet.absoluteFill, { backgroundColor: solid ? Surface.raised : 'rgba(11,13,16,0.8)' }]} />
  </View>;
};
