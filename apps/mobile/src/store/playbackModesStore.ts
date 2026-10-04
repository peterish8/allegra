/**
 * Player menu modes that live beside the queue: repeat-one and Echo's
 * "Advanced" tempo & pitch. Android applies them natively (Media3); iOS reads
 * `repeatOne` in PlayerContext (expo-audio's loop). Not persisted — like Echo,
 * a fresh launch plays at normal speed.
 */
import { create } from 'zustand';
import { NativeAudioPlayer } from '../services/NativeAudioPlayer';
import { fire } from '../playback/nativeQueue';
import type { RepeatMode } from '../../../../packages/connect/src/types';

/** Echo's tempo/pitch steps. */
export const TEMPO_STEPS = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const PITCH_STEPS = [0.75, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.25] as const;

interface PlaybackModesState {
  repeatOne: boolean;
  repeatMode: RepeatMode;
  shuffle: boolean;
  tempo: number;
  pitch: number;
  setRepeatOne: (on: boolean) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setShuffle: (on: boolean) => void;
  setTempoPitch: (tempo: number, pitch: number) => void;
}

/** Repeat off / all / one belongs to the engine on Android; elsewhere only "one" is a native loop. */
const applyRepeat = (mode: RepeatMode): void => {
  if (NativeAudioPlayer.hasQueue()) fire(NativeAudioPlayer.setRepeatMode(mode));
  else NativeAudioPlayer.setRepeatOne(mode === 'one');
};

export const usePlaybackModesStore = create<PlaybackModesState>(set => ({
  repeatOne: false,
  repeatMode: 'all',
  shuffle: false,
  tempo: 1,
  pitch: 1,
  setRepeatOne: on => {
    applyRepeat(on ? 'one' : 'all');
    set({ repeatOne: on, repeatMode: on ? 'one' : 'all' });
  },
  setRepeatMode: mode => {
    applyRepeat(mode);
    set({ repeatOne: mode === 'one', repeatMode: mode });
  },
  // On Android the engine shuffles (Echo: current song first, the rest mixed) and reports back.
  setShuffle: on => {
    if (NativeAudioPlayer.hasQueue()) fire(NativeAudioPlayer.setShuffle(on));
    set({ shuffle: on });
  },
  setTempoPitch: (tempo, pitch) => {
    NativeAudioPlayer.setPlaybackParameters(tempo, pitch);
    set({ tempo, pitch });
  },
}));
