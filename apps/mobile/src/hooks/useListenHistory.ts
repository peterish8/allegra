/**
 * The phone's whole listen log for the stats pages that open from Listening stats (1.48.0): Top artists, Top songs and
 * the insight cards. Read once when the page is shown, again when `reload` is called (a failed read can be retried).
 */
import { useCallback, useEffect, useState } from 'react';
import { firstHeard, listensSince, type ListenEntry } from '../database/listenLogQueries';

export interface ListenHistory {
  readonly loading: boolean;
  readonly failed: boolean;
  readonly log: readonly ListenEntry[];
  readonly first: ReadonlyMap<string, { at: number; artist: string }>;
  readonly reload: () => void;
}

export function useListenHistory(active: boolean): ListenHistory {
  const [log, setLog] = useState<ListenEntry[] | null>(null);
  const [first, setFirst] = useState<Map<string, { at: number; artist: string }>>(new Map());
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => { setFailed(false); setVersion(v => v + 1); }, []);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void Promise.all([listensSince(0), firstHeard()]).then(([entries, firsts]) => {
      if (!live) return;
      setLog(entries);
      setFirst(firsts);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [active, version]);

  return { loading: log === null && !failed, failed, log: log ?? [], first, reload };
}
