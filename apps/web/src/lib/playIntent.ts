/**
 * Which song pick is the newest. A pick can wait on the network (Connect routing, a catalog lookup)
 * before it reaches the player; when two overlap, the older one must not land after the newer one
 * and swap the song, the queue and the radio back, nor show its failure over a song that now plays.
 */
export interface PlayIntent {
  /** Starts a pick. Every earlier pick is superseded. */
  readonly begin: () => number;
  /** True while no newer pick has begun. */
  readonly isCurrent: (token: number) => boolean;
}

export function createPlayIntent(): PlayIntent {
  let latest = 0;
  return {
    begin: () => {
      latest += 1;
      return latest;
    },
    isCurrent: (token) => token === latest,
  };
}
