import { createContext, useContext } from 'react';

import type { UnifiedSong } from '@shared/types';

export interface QueueActions {
  /** Queue a song on the device that plays: straight after the current one, or at the end. */
  readonly add: (song: UnifiedSong, next: boolean) => void;
}

export const QueueActionsContext = createContext<QueueActions | null>(null);

/** Null outside the app shell (a shared playlist page has no player to queue into). */
export function useQueueActions(): QueueActions | null {
  return useContext(QueueActionsContext);
}
