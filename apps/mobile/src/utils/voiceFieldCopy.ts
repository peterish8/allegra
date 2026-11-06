/**
 * What voice search says, in plain TypeScript (Round 7 item 6). The copy follows the gesture that started it: a held
 * mic searches on release, a tapped one keeps listening until Stop (or until the speaker goes quiet).
 */
import type { VoiceGesture, VoicePhase } from '../store/voiceSearchStore';

/** The line under "Listening" in the Search field. */
export const fieldListeningHint = (gesture: VoiceGesture): string =>
  gesture === 'tap' ? 'Tap stop when you’re done' : 'Release to search';

/** The floating card's line while listening (older tab bars), which used to say "Let go" after a tap too. */
export const cardListeningHint = (gesture: VoiceGesture): string =>
  gesture === 'tap' ? 'Tap the mic when you’re done' : 'Let go when you’re done';

export type VoiceFieldAction = 'cancel' | 'stop' | 'retry' | 'type' | 'settings' | 'dismiss';

export interface VoiceFieldView {
  status: string;
  hint?: string;
  /** Listening or searching: the field is busy and the page under it dims. */
  busy: boolean;
  /** A problem the listener has to answer: announced as an alert, not politely. */
  alert: boolean;
  actions: VoiceFieldAction[];
}

const MIC_DENIED = 'Allow the microphone to search by voice';

/** The panel under the search field for a voice phase; null when there is nothing to show. */
export const voiceFieldView = (phase: VoicePhase, gesture: VoiceGesture, notice: string | null, query: string): VoiceFieldView | null => {
  switch (phase) {
    case 'listening':
      return { status: 'Listening', hint: fieldListeningHint(gesture), busy: true, alert: false, actions: gesture === 'tap' ? ['cancel', 'stop'] : ['cancel'] };
    case 'searching':
      return { status: 'Searching', hint: 'for what you said', busy: true, alert: false, actions: ['cancel'] };
    case 'empty':
      return { status: `No match for “${query}”`, hint: 'Try saying the artist and song name again.', busy: false, alert: false, actions: ['retry', 'type'] };
    case 'notice':
      if (!notice) return null;
      if (notice === MIC_DENIED) {
        return { status: notice, hint: 'LuvLyrics only listens while this field says Listening. Typing always works.', busy: false, alert: true, actions: ['settings', 'dismiss'] };
      }
      return { status: notice, hint: 'Nothing was searched.', busy: false, alert: true, actions: ['retry', 'dismiss'] };
    default:
      return null;
  }
};
