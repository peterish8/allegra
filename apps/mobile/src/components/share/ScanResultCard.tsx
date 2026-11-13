/**
 * What a scanned code turned out to be: the cover, the name and who it is by, with Save and Open. It rises into place
 * (opacity and translate, the cover settling from a touch smaller); while the lookup is still running the same card
 * shows a quiet placeholder so the layout never jumps when the answer lands.
 */
import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import Artwork from '../allegra/Artwork';
import { Frosted } from '../allegra/Frosted';
import { Motion, Radius } from '../../constants/allegraTheme';
import { resultCover, resultSubtitle, resultTitle, type ScanResult } from '../../services/share/scanResolve';
import { Button, Control, GUTTER, Space, Text, TextButton } from '../../ui';

export type SaveState = 'idle' | 'saving' | 'saved' | 'signed-out' | 'failed';

const ART = 64;

interface Props {
  /** Null while the lookup runs. */
  result: ScanResult | null;
  save: SaveState;
  onSave: () => void;
  onOpen: () => void;
  onAgain: () => void;
}

const saveLabel = (kind: ScanResult['kind'], state: SaveState): string => {
  if (state === 'saved') return kind === 'song' ? 'Saving to library' : 'Saved';
  if (state === 'saving') return 'Saving…';
  return 'Save';
};

const saveNote = (state: SaveState): string | null =>
  state === 'signed-out' ? 'Sign in (profile menu, Settings) to save playlists to your library.'
    : state === 'failed' ? 'Could not save it. Try again in a moment.' : null;

export const ScanResultCard: React.FC<Props> = ({ result, save, onSave, onOpen, onAgain }) => {
  const reduce = useReducedMotion();
  const rise = useSharedValue(0);
  const cover = useSharedValue(0);
  useEffect(() => {
    rise.value = reduce ? withTiming(1, { duration: Motion.duration.fast }) : withSpring(1, Motion.spring.sheet);
  }, [reduce, rise]);
  useEffect(() => {
    if (!result) return;
    cover.value = reduce ? withTiming(1, { duration: Motion.duration.fast }) : withSpring(1, Motion.spring.settle);
  }, [result, reduce, cover]);

  const card = useAnimatedStyle(() => ({ opacity: rise.value, transform: [{ translateY: reduce ? 0 : (1 - rise.value) * 28 }] }));
  const art = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * cover.value, transform: [{ scale: reduce ? 1 : 0.92 + 0.08 * cover.value }] }));
  const text = useAnimatedStyle(() => ({ opacity: cover.value }));

  const note = saveNote(save);
  return (
    <Animated.View style={[styles.card, card]} accessibilityLiveRegion="polite">
      <Frosted radius={Radius.sheet} intensity={70} tint={0.5} />
      <View style={styles.row}>
        <Animated.View style={[styles.art, art]}>
          {result ? <Artwork uri={resultCover(result)} title={resultTitle(result)} size={ART} style={StyleSheet.absoluteFill} /> : null}
        </Animated.View>
        <Animated.View style={[styles.words, text]}>
          <Text variant="row" numberOfLines={2}>{result ? resultTitle(result) : ' '}</Text>
          <Text variant="secondary" tone="secondary" numberOfLines={1}>{result ? resultSubtitle(result) : ' '}</Text>
        </Animated.View>
      </View>
      {note ? <Text variant="secondary" tone="secondary">{note}</Text> : null}
      <View style={styles.actions}>
        <Button label={result ? saveLabel(result.kind, save) : 'Save'} icon={save === 'saved' ? 'checkmark' : 'add'} variant="secondary" style={styles.action}
          disabled={!result || save === 'saving' || save === 'saved'} onPress={onSave} />
        <Button label={result?.kind === 'playlist' ? 'Open playlist' : 'Play'} icon={result?.kind === 'playlist' ? 'albums-outline' : 'play'} variant="primary" style={styles.action}
          disabled={!result} onPress={onOpen} />
      </View>
      <TextButton label="Scan another" onPress={onAgain} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  card: { marginHorizontal: GUTTER, padding: Space.md, gap: Space.sm, borderRadius: Radius.sheet, overflow: 'hidden', alignItems: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
  art: { width: ART, height: ART, borderRadius: Radius.art, overflow: 'hidden' },
  words: { flex: 1, gap: Space.xxs },
  actions: { flexDirection: 'row', gap: Space.sm },
  action: { flex: 1, minHeight: Control.target },
});
