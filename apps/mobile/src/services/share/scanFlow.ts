/**
 * The scanner's phases, as one small machine so the screen, its animation and its words cannot disagree
 * (owner, 2026-11-13: scan, resolve and save should read as one designed sequence).
 *
 *   scanning -> locked (a code read) -> resolving (asking LuvLyrics what it is) -> result (a card with Open and Save)
 *                                                         \-> failed (said on the scanner; scan again)
 *
 * Pure: no React, no network. `found` is ignored unless the scanner is looking, so a second frame that reads the same
 * code while the first is resolving can never start a second lookup.
 */
export type ScanPhase = 'scanning' | 'locked' | 'resolving' | 'result' | 'failed';
export type ScanFailure = 'gone' | 'unreachable';

export interface ScanState {
  readonly phase: ScanPhase;
  readonly failure?: ScanFailure;
}

export type ScanEvent =
  | { readonly type: 'found' }
  | { readonly type: 'lookup' }
  | { readonly type: 'resolved' }
  | { readonly type: 'failed'; readonly failure: ScanFailure }
  | { readonly type: 'reset' };

export const SCAN_START: ScanState = { phase: 'scanning' };

export function scanReducer(state: ScanState, event: ScanEvent): ScanState {
  switch (event.type) {
    case 'found': return state.phase === 'scanning' ? { phase: 'locked' } : state;
    case 'lookup': return state.phase === 'locked' ? { phase: 'resolving' } : state;
    case 'resolved': return state.phase === 'locked' || state.phase === 'resolving' ? { phase: 'result' } : state;
    case 'failed': return state.phase === 'locked' || state.phase === 'resolving' ? { phase: 'failed', failure: event.failure } : state;
    case 'reset': return SCAN_START;
  }
}

/** Whether the camera should keep taking stills. */
export const isLooking = (state: ScanState): boolean => state.phase === 'scanning';

/** The line under the frame. Sentence case, no punctuation tricks. */
export function scanStatus(state: ScanState, kind?: 'song' | 'playlist'): string {
  switch (state.phase) {
    case 'scanning': return 'Point at a LuvLyrics code';
    case 'locked': return 'Got it';
    case 'resolving': return kind === 'playlist' ? 'Finding the playlist' : kind === 'song' ? 'Finding the song' : 'Finding it';
    case 'result': return '';
    case 'failed': return state.failure === 'unreachable'
      ? 'Could not reach LuvLyrics. Check your connection and scan again.'
      : kind === 'playlist'
        ? 'That playlist is no longer shared. Ask for a new code.'
        : 'That song could not be found. Ask for a new code.';
  }
}
