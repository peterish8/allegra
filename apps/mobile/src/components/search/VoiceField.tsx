/**
 * Voice search inside the Search field (Round 7 item 6). The mic sits in the field: a tap starts listening until Stop
 * (or until the speaker goes quiet); a hold listens until release. Listening opens inside the field, under the thumb:
 * status, a live level and the transcript, with Cancel always there. The shell and the player stay where they are.
 *
 *   const voice = useVoiceField({ onHeard: query => startSearch(query) });
 *   <field … trailing={voice.trailing} />{voice.panel}
 *
 * Reduce Motion: the level holds still and the status text carries the state.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { ActivityIndicator, Linking, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';
import { useVoiceCommands } from '../../hooks/useVoiceCommands';
import { voiceLevel } from '../../playback/voiceLevel';
import { useSettingsStore } from '../../store/settingsStore';
import { useVoiceSearchStore } from '../../store/voiceSearchStore';
import { Button, Haptics, IconButton, Radius, Signal, Space, Text } from '../../ui';
import { voiceFieldView, type VoiceFieldAction } from '../../utils/voiceFieldCopy';
import { isHoldRelease } from '../VoiceMicButton';

const BARS = [0.45, 0.8, 1, 0.65, 0.9, 0.5, 0.7];

const LevelBar: React.FC<{ weight: number; still: boolean }> = ({ weight, still }) => {
  const style = useAnimatedStyle(() => ({
    transform: [{ scaleY: still ? 0.18 : 0.18 + Math.min(1, voiceLevel.value) * 0.82 * weight }],
  }));
  return <Animated.View style={[styles.bar, style]} />;
};

export interface VoiceField {
  /** The field's trailing control: the mic, or × to cancel while voice is busy. */
  trailing: React.ReactNode;
  /** The panel under the field's row, or null. */
  panel: React.ReactNode;
  /** Voice is listening or searching: the page under the field dims. */
  busy: boolean;
}

export const useVoiceField = ({ onHeard, onType }: { onHeard: (query: string) => void; onType: (text: string) => void }): VoiceField => {
  const { isListening, startListening, stopListening, cancelListening } = useVoiceCommands();
  const tapMode = useSettingsStore(s => (s.voiceMode ?? 'hold') === 'tap');
  const reduce = useReducedMotion();
  const origin = useVoiceSearchStore(s => s.origin);
  const phase = useVoiceSearchStore(s => s.phase);
  const gesture = useVoiceSearchStore(s => s.gesture);
  const notice = useVoiceSearchStore(s => s.notice);
  const query = useVoiceSearchStore(s => s.query);
  const transcript = useVoiceSearchStore(s => s.transcript);
  const mine = origin === 'field';
  const pressedAt = useRef(0);
  const wasListening = useRef(false);

  // What was heard goes into the field, so it can be edited, and the normal results load under it.
  useEffect(() => {
    if (mine && (phase === 'results' || phase === 'empty') && query) onHeard(query);
  }, [mine, phase, query, onHeard]);

  const pressIn = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    pressedAt.current = Date.now();
    wasListening.current = isListening;
    if (isListening) return;
    useVoiceSearchStore.getState().setOrigin('field');
    if (tapMode) useVoiceSearchStore.getState().setGesture('tap');
    startListening();
  }, [isListening, startListening, tapMode]);

  const pressOut = useCallback(() => {
    if (wasListening.current) { stopListening(); return; }
    if (!tapMode && isHoldRelease(pressedAt.current, Date.now())) { stopListening(); return; }
    useVoiceSearchStore.getState().setGesture('tap');
  }, [stopListening, tapMode]);

  const cancel = useCallback(() => { cancelListening(); useVoiceSearchStore.getState().dismiss(); }, [cancelListening]);
  const retry = useCallback(() => {
    useVoiceSearchStore.getState().setOrigin('field');
    useVoiceSearchStore.getState().setGesture('tap');
    startListening();
  }, [startListening]);

  const view = mine ? voiceFieldView(phase, gesture, notice, query) : null;
  const busy = !!view?.busy;

  const trailing = busy
    ? <IconButton icon="close" label="Cancel voice search" onPress={cancel} />
    : <IconButton icon="mic" label={tapMode ? 'Search by voice. Tap to start' : 'Search by voice. Tap to start, or hold and speak'}
        onPress={() => {}} onPressIn={pressIn} onPressOut={pressOut} />;

  const act = (action: VoiceFieldAction) => {
    switch (action) {
      case 'cancel': cancel(); break;
      case 'stop': stopListening(); break;
      case 'retry': retry(); break;
      case 'type': { const text = query; useVoiceSearchStore.getState().dismiss(); onType(text); break; }
      case 'settings': useVoiceSearchStore.getState().dismiss(); Linking.openSettings().catch(() => {}); break;
      case 'dismiss': useVoiceSearchStore.getState().dismiss(); break;
    }
  };
  const LABEL: Record<VoiceFieldAction, string> = {
    cancel: 'Cancel', stop: 'Stop and search', retry: 'Try again', type: 'Type instead', settings: 'Open settings', dismiss: 'Not now',
  };
  const primary: VoiceFieldAction[] = ['stop', 'retry', 'settings'];

  const panel = view ? (
    <View style={styles.panel} accessibilityLiveRegion={view.alert ? 'assertive' : 'polite'}
      accessibilityRole={view.alert ? 'alert' : undefined}>
      <View style={styles.status}>
        {phase === 'listening'
          ? <View style={styles.wave} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {BARS.map((w, i) => <LevelBar key={i} weight={w} still={reduce} />)}
            </View>
          : phase === 'searching' ? <ActivityIndicator color={Signal.ink} /> : null}
        <View style={styles.statusText}>
          <Text variant="label" numberOfLines={2}>{view.status}</Text>
          {view.hint ? <Text variant="secondary" tone="secondary">{view.hint}</Text> : null}
        </View>
      </View>
      {phase === 'listening' || phase === 'searching'
        ? <Text variant="body" style={styles.transcript} numberOfLines={3}>{transcript || 'Say a song or an artist'}</Text> : null}
      <View style={styles.actions}>
        {view.actions.map(action => (
          <Button key={action} label={LABEL[action]} size="compact" haptic="select"
            icon={action === 'stop' ? 'stop' : action === 'retry' ? 'mic' : undefined}
            variant={primary.includes(action) ? 'primary' : 'plain'} onPress={() => act(action)} />
        ))}
      </View>
    </View>
  ) : null;

  return { trailing, panel, busy };
};

const styles = StyleSheet.create({
  panel: { paddingHorizontal: Space.md, paddingTop: Space.xxs, paddingBottom: Space.sm, gap: Space.xs },
  status: { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  statusText: { flex: 1, minWidth: 0 },
  wave: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 28 },
  bar: { width: 3, height: 28, borderRadius: Radius.pill, backgroundColor: Signal.ink },
  transcript: { color: Signal.ink },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexWrap: 'wrap' },
});
