/**
 * Listening stats for the page (1.45.0): the phone's listen log read once, each range computed from it on the spot
 * (services/stats/listeningStats), refreshed as new listens land while the page is open, and the tempo of the songs
 * in heavy rotation filled in as it is found (services/stats/tempo).
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { firstHeard, listensSince, type ListenEntry } from '../database/listenLogQueries';
import { computeStats, tempoSummary, type ListeningStats, type StatsRange, type TempoSummary } from '../services/stats/listeningStats';
import { setOnListenLogged } from '../services/stats/listenLog';
import { tempoFor } from '../services/stats/tempo';

export interface ListeningStatsState {
  readonly loading: boolean;
  readonly stats: ListeningStats | null;
  readonly tempo: TempoSummary | null;
  /** Tempos are still being looked up for this range. */
  readonly tempoBusy: boolean;
  readonly reload: () => void;
  /** The whole log the stats were computed from (the insight cards read albums from it). */
  readonly log: readonly ListenEntry[];
  /** The phone's log could not be read. */
  readonly failed: boolean;
}

export function useListeningStats(range: StatsRange, active: boolean): ListeningStatsState {
  const [log, setLog] = useState<ListenEntry[] | null>(null);
  const [first, setFirst] = useState<Map<string, { at: number; artist: string }>>(new Map());
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    if (!active) return;
    let live = true;
    void Promise.all([listensSince(0), firstHeard()]).then(([entries, firsts]) => {
      if (!live) return;
      setLog(entries);
      setFirst(firsts);
      setFailed(false);
    }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [active, version]);

  // New listens land while the page is open (music keeps playing under it).
  useEffect(() => {
    if (!active) return;
    setOnListenLogged(reload);
    return () => setOnListenLogged(null);
  }, [active, reload]);

  const stats = useMemo(() => (log ? computeStats(log, range, Date.now(), first) : null), [log, range, first]);

  const [tempos, setTempos] = useState<Map<string, number | null>>(new Map());
  const [tempoBusy, setTempoBusy] = useState(false);
  const rotationKey = stats?.heavyRotation.map(s => s.key).join('|') ?? '';
  useEffect(() => {
    if (!active || !stats || stats.heavyRotation.length === 0) return;
    let live = true;
    setTempoBusy(true);
    void tempoFor(stats.heavyRotation, found => { if (live) setTempos(found); }, undefined, () => live)
      .finally(() => { if (live) setTempoBusy(false); });
    return () => { live = false; };
  // The songs, not the stats object (rebuilt on every listen).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, rotationKey]);

  const tempo = useMemo(() => (stats ? tempoSummary(stats.heavyRotation, tempos) : null), [stats, tempos]);
  return { loading: log === null && !failed, stats, tempo, tempoBusy, reload, log: log ?? [], failed };
}
