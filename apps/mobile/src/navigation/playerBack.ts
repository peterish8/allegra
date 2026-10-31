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

let focusedPlayerBackHandler: (() => void) | null = null;

/** Register the active player's Back action; only the focused screen owns it. */
export function registerPlayerBackHandler(handler: () => void): () => void {
  focusedPlayerBackHandler = handler;
  return () => {
    if (focusedPlayerBackHandler === handler) focusedPlayerBackHandler = null;
  };
}

/** Consume Android Back before NavigationContainer's default stack pop. */
export function consumePlayerHardwareBack(): boolean {
  if (!focusedPlayerBackHandler) return false;
  focusedPlayerBackHandler();
  return true;
}

export function handlePlayerBack(state: PlayerBackState, actions: PlayerBackActions): void {
  if (state.lyricsFullscreen) actions.exitLyricsFullscreen();
  else if (state.hasSheet) actions.closeSheet();
  else if (state.upNextOpen) actions.closeUpNext();
  else if (state.ambient) actions.leaveAmbient();
  else actions.closePlayer();
}
