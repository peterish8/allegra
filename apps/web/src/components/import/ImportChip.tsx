'use client';

import Link from 'next/link';

import { useSpotifyTransfer } from '../../lib/spotifyTransfer';
import { paths } from '../../lib/routes';

/**
 * While a Spotify transfer runs and you are on another page: a small chip saying how far it has got,
 * with the way back. The transfer itself never depends on this being on screen.
 */
export function ImportChip({ hidden }: { readonly hidden: boolean }) {
  const job = useSpotifyTransfer();
  if (!job.syncing || hidden) return null;
  const done = [...job.runs.values()].filter((run) => run.state === 'done').length;
  return (
    <Link className="import-chip" href={paths.import} aria-label={`Moving ${Math.min(done + 1, job.order.length)} of ${job.order.length} from Spotify. Open Import`}>
      <span className="import-chip__spinner" aria-hidden="true" />
      <span>Moving {Math.min(done + 1, job.order.length)} of {job.order.length} from Spotify</span>
    </Link>
  );
}
