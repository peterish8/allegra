/**
 * Sheets that rise over Now Playing: the sleep timer, the ••• menu, details, LuvLink. The app's one `Sheet`
 * (src/ui/Sheet), drawn inside the player and tinted by the playing cover. (The queue is Up next, `UpNextPanel`.)
 */
import React from 'react';
import { View } from 'react-native';
import { durationSV, positionSV } from '../../playback/positionBus';
import { usePlayerStore } from '../../store/playerStore';
import { SLEEP_CHOICES, SleepChoice, useSleepTimerStore } from '../../store/sleepTimerStore';
import { Sheet, SheetOption } from '../../ui';
import { useArtworkPalette } from '../allegra/useArtworkPalette';

export { SheetScrollable, SheetScrollView } from '../../ui/Sheet';

interface PlayerSheetProps {
  visible: boolean;
  /** Leave out for a sheet that starts straight with its content (the ••• menu). */
  title?: string;
  /** Room for a long list (the menu, LuvLink): up to 88% of the screen. */
  tall?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export const PlayerSheet: React.FC<PlayerSheetProps> = ({ visible, title, tall = false, onClose, children }) => {
  // The same glass as Up next: clear, tinted by the playing cover.
  const cover = usePlayerStore(s => s.currentSong?.coverImageUri);
  const palette = useArtworkPalette(cover);
  return (
    <Sheet visible={visible} title={title} tall={tall} onClose={onClose} palette={palette} presentation="inline">
      {children}
    </Sheet>
  );
};

const choiceLabel = (c: SleepChoice) => (c === 'end' ? 'End of this song' : `${c} minutes`);

/** Sleep timer choices; the active one is ticked. */
export const SleepTimerList: React.FC<{ onPicked: () => void }> = ({ onPicked }) => {
  const choice = useSleepTimerStore(s => s.choice);
  const { start, cancel } = useSleepTimerStore.getState();
  const pick = (c: SleepChoice | null) => {
    if (c === null) cancel();
    else start(c, Math.max(0, durationSV.value - positionSV.value));
    onPicked();
  };
  return (
    <View>
      {SLEEP_CHOICES.map(c => (
        <SheetOption key={String(c)} label={choiceLabel(c)} selected={choice === c} onPress={() => pick(c)} />
      ))}
      {choice !== null ? <SheetOption label="Turn off timer" destructive onPress={() => pick(null)} /> : null}
    </View>
  );
};
