import { diag } from '../utils/diag';

/** Back closes the topmost player surface before it closes the player itself. */
export interface PlayerBackState {
  lyricsFullscreen: boolean;
  hasSheet: boolean;
  upNextOpen: boolean;
  ambient: boolean;
}

export interface PlayerBackActions {
  exitLyricsFullscreen: () => void;
  closeSheet: () => void;
  closeUpNext: () => void;
  leaveAmbient: () => void;
  closePlayer: () => void;
}

type PlayerBackRegistration = { id: number; handler: () => void };

let focusedPlayerBackRegistration: PlayerBackRegistration | null = null;
let nextPlayerBackRegistrationId = 0;

/** Register the active player's Back action; only the focused screen owns it. */
export function registerPlayerBackHandler(handler: () => void): () => void {
  const registration = { id: ++nextPlayerBackRegistrationId, handler };
  diag('player-back', `register ${registration.id}`);
  focusedPlayerBackRegistration = registration;
  return () => {
    const active = focusedPlayerBackRegistration === registration;
    diag('player-back', `unregister ${registration.id}${active ? ' active' : ' stale'}`);
    if (active) focusedPlayerBackRegistration = null;
  };
}

/** Consume Android Back before NavigationContainer's default stack pop. */
export function consumePlayerHardwareBack(): boolean {
  const registration = focusedPlayerBackRegistration;
  diag('player-back', registration ? `consume ${registration.id}` : 'no focused handler');
  if (!registration) return false;
  registration.handler();
  return true;
}

export function handlePlayerBack(state: PlayerBackState, actions: PlayerBackActions): void {
  if (state.lyricsFullscreen) actions.exitLyricsFullscreen();
  else if (state.hasSheet) actions.closeSheet();
  else if (state.upNextOpen) actions.closeUpNext();
  else if (state.ambient) actions.leaveAmbient();
  else actions.closePlayer();
}
