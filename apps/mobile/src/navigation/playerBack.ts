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

export function handlePlayerBack(state: PlayerBackState, actions: PlayerBackActions): void {
  if (state.lyricsFullscreen) actions.exitLyricsFullscreen();
  else if (state.hasSheet) actions.closeSheet();
  else if (state.upNextOpen) actions.closeUpNext();
  else if (state.ambient) actions.leaveAmbient();
  else actions.closePlayer();
}
