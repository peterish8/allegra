import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

import type { UnifiedSong } from '@shared/types';

import { useSettings } from './useSettings';
import { ensureElementGraph, type ElementGraph } from '../lib/audioGraph';
import type { KaraokeMix } from '../lib/karaokeMix';
import {
  aiBlock,
  audioBufferToStereo44k,
  blockCopy,
  clearVerdict,
  deviceFacts,
  ensureBridge,
  existingSeparator,
  fetchAndDecodeSong,
  getSeparator,
  hasDownloadConsent,
  isRoformerLikelySupported,
  LiveKaraokeStream,
  markKaraokeUsed,
  markMixHintSeen,
  mixHintSeen,
  prepareMidSideKaraoke,
  recordSlowRun,
  ROFORMER_MODEL,
  ROFORMER_SAMPLE_RATE,
  roformerModelOnDevice,
  saveDownloadConsent,
  saveVerdict,
  usedKaraokeRecently,
  type AiBlock,
  type KaraokeBridge,
  type LiveKaraokeBackend,
  type LiveKaraokeStatus,
  type ModelLoadProgress
} from '../lib/liveKaraoke';

export interface LiveKaraokePlayback {
  /** The layout's single <audio> element; karaoke routes it through Web Audio. */
  readonly audioRef: RefObject<HTMLAudioElement | null>;
  readonly swapAudioSource: (streamUrl: string) => Promise<boolean>;
}

/** What karaoke is waiting on, for the loader. */
export type KaraokeStage =
  | { readonly kind: 'song' }
  | { readonly kind: 'model-check' }
  | { readonly kind: 'model-download'; readonly loaded: number; readonly total: number }
  | { readonly kind: 'model-verify' }
  | { readonly kind: 'model-save' }
  | { readonly kind: 'model-start' }
  | { readonly kind: 'separating'; readonly eta: number | null };

/** Which stretches of the song the AI model has separated, for the seek bar. */
export interface KaraokeCoverage {
  readonly ready: Uint8Array;
  readonly working: number | null;
  readonly segmentSeconds: number;
  readonly totalSeconds: number;
}

export interface LiveKaraokeController {
  readonly status: LiveKaraokeStatus;
  readonly backend: LiveKaraokeBackend | null;
  /** Karaoke is on: vocals are down, by the bridge or the AI stems. */
  readonly active: boolean;
  /** The AI model is being prepared. Karaoke is already on (the bridge plays) meanwhile. */
  readonly busy: boolean;
  readonly stage: KaraokeStage | null;
  readonly error: string | null;
  readonly monoWarning: boolean;
  /** Why the AI model is not running, when that is the device or a choice. */
  readonly block: AiBlock | null;
  /** Technical detail when the AI model failed after starting. */
  readonly fallbackReason: string | null;
  /** Vocal / instrument levels. Saved on this device and applied live. */
  readonly mix: KaraokeMix;
  readonly setMix: (mix: KaraokeMix) => void;
  /** Whether the sliders can do anything right now: only the AI model produces two real stems. */
  readonly supportsMix: boolean;
  readonly coverage: KaraokeCoverage | null;
  /** Waiting for the listener to agree to the model download. */
  readonly consent: { readonly bytes: number } | null;
  readonly answerConsent: (download: boolean) => void;
  /** Select the AI model and allow the listener to answer the download prompt again. */
  readonly chooseAiModel: () => void;
  /** Point out the mix once, the first time the AI stems play. */
  readonly showMixHint: boolean;
  readonly dismissMixHint: () => void;
  /** Milestones for a polite live region; never the percentage. */
  readonly announcement: string;
  readonly toggle: () => Promise<void>;
  readonly clearError: () => void;
}

type Engine = 'off' | 'bridge' | 'ai' | 'rendered';

const RAMP_SECONDS = 0.015;
const MODEL_BYTES = ROFORMER_MODEL.graphBytes + ROFORMER_MODEL.dataBytes;
/** Chunks of the next song separated ahead: its first ~20 s. */
const PREFETCH_CHUNKS = [0, 1] as const;
/** Wait this long after playback starts before warming the model, so it never competes with the song loading. */
const WARM_UP_DELAY_MS = 8000;

/** Songs whose separated audio stays in memory after a change: the previous one on roomy devices. */
function parkedLimit(): number {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  return memory === undefined || memory >= 8 ? 1 : 0;
}

function ramp(param: AudioParam, value: number, context: BaseAudioContext): void {
  const now = context.currentTime;
  param.cancelScheduledValues(now);
  param.setValueAtTime(param.value, now);
  param.linearRampToValueAtTime(value, now + RAMP_SECONDS);
}

/**
 * Browser live karaoke.
 *
 * A press turns the vocals down at once with the live mid-side bridge (Web Audio nodes on
 * the element's own sound). Where the device can run it, the Mel-Band RoFormer model then
 * separates the song chunk by chunk, starting at the playhead, and each separated stretch
 * replaces the bridge as it arrives. Separated chunks are cached on the device, so a song
 * is separated once.
 *
 * The <audio> element keeps its source throughout: transport, seeking and lyrics are
 * untouched. Only a browser without Web Audio falls back to rendering a mid-side file and
 * swapping it in.
 */
export function useLiveKaraoke(song: UnifiedSong | null, playback: LiveKaraokePlayback, upNext: UnifiedSong | null = null): LiveKaraokeController {
  const [status, setStatus] = useState<LiveKaraokeStatus>('idle');
  const [engine, setEngineState] = useState<Engine>('off');
  const [stage, setStage] = useState<KaraokeStage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monoWarning, setMonoWarning] = useState(false);
  const [block, setBlock] = useState<AiBlock | null>(null);
  const [fallbackReason, setFallbackReason] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<KaraokeCoverage | null>(null);
  const [consent, setConsent] = useState<{ bytes: number } | null>(null);
  const [showMixHint, setShowMixHint] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [settings, updateSettings] = useSettings();
  const mix = settings.karaokeMix;
  const mixRef = useRef(mix);
  mixRef.current = mix;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const playbackRef = useRef(playback);
  playbackRef.current = playback;
  const songRef = useRef<UnifiedSong | null>(song);
  songRef.current = song;
  const upNextRef = useRef<UnifiedSong | null>(upNext);
  upNextRef.current = upNext;

  /** The listener wants karaoke on. Survives song changes when "stay on" is set. */
  const intentRef = useRef(false);
  const engineRef = useRef<Engine>('off');
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const graphRef = useRef<ElementGraph | null>(null);
  const bridgeRef = useRef<KaraokeBridge | null>(null);
  const streamRef = useRef<LiveKaraokeStream | null>(null);
  /** Separated songs kept after a change, most recent last. */
  const parkedRef = useRef<LiveKaraokeStream[]>([]);
  /** The stream has had separated audio at the playhead at least once this press. */
  const wasReadyRef = useRef(false);
  const renderedBlobRef = useRef<string | null>(null);
  const consentResolveRef = useRef<((download: boolean) => void) | null>(null);
  const declinedRef = useRef(false);
  const modelOnDeviceRef = useRef(false);
  const prefetchRef = useRef<{ songId: string; abort: AbortController } | null>(null);

  const setEngine = useCallback((next: Engine): void => {
    engineRef.current = next;
    setEngineState(next);
  }, []);

  const refreshCoverage = useCallback((): void => {
    const stream = streamRef.current;
    if (!stream || engineRef.current !== 'ai') {
      setCoverage(null);
      return;
    }
    const c = stream.coverage();
    setCoverage({ ...c, totalSeconds: stream.song.totalSamples / ROFORMER_SAMPLE_RATE });
  }, []);

  const cancelPrefetch = useCallback((): void => {
    if (!prefetchRef.current) return;
    prefetchRef.current.abort.abort();
    prefetchRef.current = null;
    existingSeparator()?.cancelPrefetch();
  }, []);

  /** Bridge in, original out. Sync, so a press changes the sound inside the click. */
  const bridgeOn = useCallback((): boolean => {
    const audio = playbackRef.current.audioRef.current;
    const graph = audio ? ensureElementGraph(audio) : null;
    if (!graph) return false;
    graphRef.current = graph;
    const bridge = ensureBridge(graph);
    bridgeRef.current = bridge;
    bridge.setMono(false);
    bridge.attach();
    ramp(graph.dry.gain, 0, graph.context);
    ramp(bridge.gain.gain, 1, graph.context);
    return true;
  }, []);

  const bridgeOff = useCallback((): void => {
    const graph = graphRef.current;
    const bridge = bridgeRef.current;
    if (!graph || !bridge) return;
    ramp(graph.dry.gain, 1, graph.context);
    ramp(bridge.gain.gain, 0, graph.context);
    // Detach once the fade is done, unless karaoke came back on meanwhile.
    window.setTimeout(() => {
      if (!intentRef.current) bridge.detach();
    }, RAMP_SECONDS * 1000 + 60);
  }, []);

  /** Song changed or karaoke ended: keep the stream's work for a possible return, within limits. */
  const parkStream = useCallback((): void => {
    const stream = streamRef.current;
    streamRef.current = null;
    if (!stream) return;
    stream.park();
    const parked = parkedRef.current.filter((s) => s !== stream && s.song.songId !== stream.song.songId);
    parked.push(stream);
    while (parked.length > parkedLimit()) parked.shift()?.dispose();
    parkedRef.current = parked;
  }, []);

  const revokeRendered = useCallback((): void => {
    if (renderedBlobRef.current) {
      URL.revokeObjectURL(renderedBlobRef.current);
      renderedBlobRef.current = null;
    }
  }, []);

  /** The AI model is out for this press: the bridge carries on alone. */
  const settleOnBridge = useCallback(
    (reason: { block?: AiBlock; technical?: string }): void => {
      if (streamRef.current) {
        streamRef.current.dispose();
        streamRef.current = null;
      }
      setEngine('bridge');
      setBlock(reason.block ?? null);
      setFallbackReason(reason.technical ?? null);
      setStage(null);
      setCoverage(null);
      setStatus('active');
      setAnnouncement(`Karaoke on. ${reason.block ? blockCopy(reason.block).summary : 'Light remover, the AI model stopped'}.`);
    },
    [setEngine]
  );

  /** Browsers without Web Audio: render a mid-side file and swap it in as the source. */
  const runRendered = useCallback(
    async (current: UnifiedSong, generation: number, signal: AbortSignal): Promise<void> => {
      const stale = (): boolean => generation !== generationRef.current;
      setEngine('rendered');
      setStatus('processing');
      setStage({ kind: 'song' });
      try {
        const decoded = await fetchAndDecodeSong(current.streamUrl, current.id, signal);
        if (stale()) return;
        const result = await prepareMidSideKaraoke(decoded, { signal, fallbackReason: 'Web Audio is unavailable' });
        if (stale()) {
          URL.revokeObjectURL(result.blobUrl);
          return;
        }
        revokeRendered();
        renderedBlobRef.current = result.blobUrl;
        const ok = await playbackRef.current.swapAudioSource(result.blobUrl);
        if (stale()) return;
        if (!ok) throw new Error('Could not switch to the instrumental. Try playing the song again.');
        setMonoWarning(result.monoSource);
        setStage(null);
        setStatus('active');
        setAnnouncement('Karaoke on with the light remover.');
      } catch (err) {
        if ((err instanceof DOMException && err.name === 'AbortError') || stale()) return;
        revokeRendered();
        intentRef.current = false;
        setEngine('off');
        setStage(null);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Live karaoke failed.');
      }
    },
    [revokeRendered, setEngine]
  );

  /** Download and decode a song for the separator. */
  const loadSongAudio = useCallback(async (target: UnifiedSong, signal: AbortSignal) => {
    const decoded = await fetchAndDecodeSong(target.streamUrl, target.id, signal);
    return { pcm: audioBufferToStereo44k(decoded), mono: decoded.numberOfChannels < 2, totalSamples: decoded.length };
  }, []);

  const askConsent = useCallback((): Promise<boolean> => {
    setConsent({ bytes: MODEL_BYTES });
    return new Promise((resolve) => {
      consentResolveRef.current = resolve;
    });
  }, []);

  const answerConsent = useCallback((download: boolean): void => {
    const resolve = consentResolveRef.current;
    consentResolveRef.current = null;
    setConsent(null);
    if (download) saveDownloadConsent(true);
    else declinedRef.current = true;
    resolve?.(download);
  }, []);

  /** Start the AI path for the current song. The bridge is already playing. */
  const startAi = useCallback(
    async (current: UnifiedSong, generation: number, signal: AbortSignal): Promise<void> => {
      const audio = playbackRef.current.audioRef.current;
      const graph = graphRef.current;
      const bridge = bridgeRef.current;
      if (!audio || !graph || !bridge) return;
      const stale = (): boolean => generation !== generationRef.current || songRef.current?.id !== current.id;

      const events = {
        onModelProgress: (p: ModelLoadProgress) => {
          if (stale() || wasReadyRef.current) return;
          switch (p.phase) {
            case 'checking':
              setStage({ kind: 'model-check' });
              break;
            case 'downloading':
              setStage({ kind: 'model-download', loaded: p.loadedBytes ?? 0, total: p.totalBytes ?? MODEL_BYTES });
              break;
            case 'verifying':
              setStage({ kind: 'model-verify' });
              break;
            case 'caching':
              setStage({ kind: 'model-save' });
              break;
            case 'model-ready':
            case 'session':
              modelOnDeviceRef.current = true;
              setStage({ kind: 'model-start' });
              break;
            case 'ready':
              modelOnDeviceRef.current = true;
              setStage({ kind: 'separating', eta: streamRef.current?.etaSeconds() ?? null });
              break;
            default:
              setStage({ kind: 'model-start' });
          }
        },
        onReadinessChange: (ready: boolean) => {
          if (stale() || engineRef.current !== 'ai') return;
          if (ready) {
            const first = !wasReadyRef.current;
            wasReadyRef.current = true;
            setStatus('active');
            setStage(null);
            setBlock(null);
            setFallbackReason(null);
            setAnnouncement(first ? 'AI vocal removal on.' : 'AI vocal removal back.');
            if (first && !mixHintSeen()) setShowMixHint(true);
          } else if (wasReadyRef.current) {
            setStatus('catching-up');
            setStage({ kind: 'separating', eta: streamRef.current?.etaSeconds() ?? null });
            setAnnouncement('Catching up. Light vocal removal until the AI is ready here.');
          }
        },
        onCoverage: () => {
          if (stale()) return;
          refreshCoverage();
          maybePrefetchRef.current();
        },
        onKeepingUp: () => saveVerdict('ok'),
        onTooSlow: () => {
          recordSlowRun();
          if (!stale()) settleOnBridge({ block: 'too-slow' });
        },
        onNeedsAudio: () => {
          void (async () => {
            try {
              const loaded = await loadSongAudio(current, signal);
              if (!stale()) streamRef.current?.provideAudio(loaded.pcm);
            } catch (err) {
              if (!(err instanceof DOMException && err.name === 'AbortError') && !stale()) {
                settleOnBridge({ technical: err instanceof Error ? err.message : 'Could not load the song' });
              }
            }
          })();
        },
        onError: (message: string) => {
          if (!stale()) settleOnBridge({ technical: message });
        }
      };

      setEngine('ai');
      setStatus('loading');
      wasReadyRef.current = false;
      markKaraokeUsed();
      const separator = getSeparator();

      // Same song as before, or one still in memory: carry on where it left off.
      let kept = streamRef.current?.song.songId === current.id ? streamRef.current : null;
      if (!kept) {
        parkStream();
        kept = parkedRef.current.find((s) => s.song.songId === current.id) ?? null;
        if (kept) parkedRef.current = parkedRef.current.filter((s) => s !== kept);
      }
      if (kept) {
        kept.rebind(events);
        kept.setMix(mixRef.current);
        streamRef.current = kept;
        if (kept.song.mono) {
          bridge.setMono(true);
          setMonoWarning(true);
        }
        setStage(kept.complete || separator.modelReady ? { kind: 'separating', eta: null } : { kind: 'model-check' });
        kept.enable(null);
        refreshCoverage();
        return;
      }

      const onDevice = await separator.probe(current.id);
      if (stale()) return;
      let shape = onDevice.song;
      let pcm = null;
      if (!shape) {
        setStage({ kind: 'song' });
        const loaded = await loadSongAudio(current, signal);
        if (stale()) return;
        shape = { totalSamples: loaded.totalSamples, mono: loaded.mono, chunkCount: 0 };
        pcm = loaded.pcm;
      }
      if (shape.mono) {
        bridge.setMono(true);
        setMonoWarning(true);
      }
      const stream = new LiveKaraokeStream(
        audio,
        graph,
        bridge.gain,
        { songId: current.id, totalSamples: shape.totalSamples, mono: shape.mono },
        events,
        mixRef.current
      );
      streamRef.current = stream;
      setStage(onDevice.cached.length > 0 || separator.modelReady ? { kind: 'separating', eta: null } : { kind: 'model-check' });
      stream.enable(pcm);
      refreshCoverage();
    },
    // maybePrefetchRef is a ref: stable.
    [loadSongAudio, parkStream, refreshCoverage, setEngine, settleOnBridge]
  );

  /** Turn karaoke on for the current song. Synchronous up to the bridge, so it sounds within the click. */
  const start = useCallback(
    async (current: UnifiedSong): Promise<void> => {
      const generation = ++generationRef.current;
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      intentRef.current = true;
      // A download question still open for the previous song is asked again for this one.
      const pending = consentResolveRef.current;
      consentResolveRef.current = null;
      pending?.(false);
      // A rendered instrumental belonged to the previous song; the element has moved on.
      if (engineRef.current === 'rendered') revokeRendered();
      setError(null);
      setBlock(null);
      setFallbackReason(null);
      setMonoWarning(false);
      setCoverage(null);
      setStage(null);

      if (!bridgeOn()) {
        await runRendered(current, generation, ac.signal);
        return;
      }
      setEngine('bridge');
      setStatus('loading');
      setAnnouncement('Karaoke on.');
      const bridge = bridgeRef.current!;
      void bridge.measureStereo(ac.signal).then((result) => {
        if (generation !== generationRef.current || result !== 'mono') return;
        bridge.setMono(true);
        setMonoWarning(true);
      });

      try {
        const mode = settingsRef.current.karaokeMode;
        if (!modelOnDeviceRef.current) modelOnDeviceRef.current = await roformerModelOnDevice();
        if (generation !== generationRef.current) return;
        const facts = await deviceFacts(mode, modelOnDeviceRef.current);
        if (generation !== generationRef.current) return;
        let reason = aiBlock(facts) ?? (isRoformerLikelySupported() ? null : 'no-worker');
        if (!reason && !facts.modelOnDevice && !hasDownloadConsent()) {
          reason = declinedRef.current ? 'declined' : (await askConsent()) ? null : 'declined';
          if (generation !== generationRef.current) return;
        }
        if (reason) {
          settleOnBridge({ block: reason });
          return;
        }
        await startAi(current, generation, ac.signal);
      } catch (err) {
        if ((err instanceof DOMException && err.name === 'AbortError') || generation !== generationRef.current) return;
        settleOnBridge({ technical: err instanceof Error ? err.message : 'AI model unavailable' });
      }
    },
    [askConsent, bridgeOn, revokeRendered, runRendered, setEngine, settleOnBridge, startAi]
  );

  /** Explicitly choosing the model re-arms consent after a previous "Not now" answer. */
  const chooseAiModel = useCallback((): void => {
    declinedRef.current = false;
    clearVerdict();
    settingsRef.current = { ...settingsRef.current, karaokeMode: 'ai' };
    updateSettings({ karaokeMode: 'ai' });
    const current = songRef.current;
    if (current && intentRef.current && engineRef.current !== 'ai') void start(current);
  }, [start, updateSettings]);

  /** Everything off: bridge out, stems out, original back. */
  const stop = useCallback(
    async (opts: { keepIntent?: boolean } = {}): Promise<void> => {
      generationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      if (!opts.keepIntent) intentRef.current = false;
      if (consentResolveRef.current) {
        const resolve = consentResolveRef.current;
        consentResolveRef.current = null;
        setConsent(null);
        resolve(false);
      }
      cancelPrefetch();
      const separator = existingSeparator();
      // Cancel a model download nobody is waiting for any more; what arrived stays on disk.
      if (separator && !separator.modelReady) separator.abortWarm();
      streamRef.current?.disable();
      const wasRendered = engineRef.current === 'rendered';
      setEngine('off');
      setStatus('idle');
      setStage(null);
      setCoverage(null);
      setBlock(null);
      setFallbackReason(null);
      setShowMixHint(false);
      if (wasRendered) {
        const current = songRef.current;
        if (current) {
          const ok = await playbackRef.current.swapAudioSource(current.streamUrl).catch(() => false);
          if (!ok) setError('Could not restore the original track.');
        }
        revokeRendered();
      } else {
        bridgeOff();
      }
      setAnnouncement('Karaoke off.');
    },
    [bridgeOff, cancelPrefetch, revokeRendered, setEngine]
  );

  /** Prepare the next song's opening while this one is comfortably ahead. */
  const maybePrefetchRef = useRef<() => void>(() => undefined);
  maybePrefetchRef.current = () => {
    const next = upNextRef.current;
    const stream = streamRef.current;
    if (!next || !stream || engineRef.current !== 'ai' || !settingsRef.current.karaokeStayOn) return;
    if (next.id === songRef.current?.id || prefetchRef.current?.songId === next.id || !stream.comfortable()) return;
    cancelPrefetch();
    const abort = new AbortController();
    prefetchRef.current = { songId: next.id, abort };
    void (async () => {
      try {
        const separator = getSeparator();
        const onDevice = await separator.probe(next.id);
        const missing = PREFETCH_CHUNKS.filter((k) => !onDevice.cached.includes(k));
        if (missing.length === 0 || onDevice.hasAudio || abort.signal.aborted) return;
        const loaded = await loadSongAudio(next, abort.signal);
        if (abort.signal.aborted || prefetchRef.current?.abort !== abort) return;
        separator.prefetch(next.id, loaded.totalSamples, loaded.mono, loaded.pcm, missing);
      } catch {
        // A failed prefetch only means the next song starts on the bridge, as before.
      }
    })();
  };

  // Song changed (or playback moved to another device): park this song's work, then carry
  // karaoke on into the new song if the listener wants it to stay on.
  useEffect(() => {
    const keep = intentRef.current && settingsRef.current.karaokeStayOn && song !== null;
    if (prefetchRef.current && prefetchRef.current.songId !== song?.id) cancelPrefetch();
    else prefetchRef.current = null;
    parkStream();
    setMonoWarning(false);
    setError(null);
    if (engineRef.current === 'off' && !keep) return;
    // Staying on: start over for the new song with the bridge still up, so no vocals slip through.
    if (keep && song) void start(song);
    else void stop();
    // Only the song's identity matters here; `start`/`stop` read everything else from refs.
  }, [song?.id]);

  // The next song changed: a prefetch for the old one is wasted work.
  useEffect(() => {
    if (prefetchRef.current && prefetchRef.current.songId !== upNext?.id) cancelPrefetch();
  }, [upNext?.id, cancelPrefetch]);

  // Slider moves (here or in Settings, or in another tab) reach the stream as they happen.
  useEffect(() => {
    streamRef.current?.setMix(mix);
  }, [mix]);

  // The loader's countdown: re-estimate each second while waiting on the model.
  useEffect(() => {
    if (engine !== 'ai' || !(status === 'catching-up' || stage?.kind === 'separating')) return undefined;
    const timer = window.setInterval(() => {
      const eta = streamRef.current?.etaSeconds() ?? null;
      setStage((current) => (current?.kind === 'separating' ? { kind: 'separating', eta } : current));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [engine, status, stage?.kind]);

  // Warm the model up in idle time for listeners who use karaoke, so a press costs only the first chunk.
  useEffect(() => {
    if (!song || !settings.karaokeWarmUp) return undefined;
    if (existingSeparator()?.modelReady || !usedKaraokeRecently() || !hasDownloadConsent()) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (!(await roformerModelOnDevice()) || cancelled) return;
        const facts = await deviceFacts(settings.karaokeMode, true);
        if (cancelled || aiBlock(facts)) return;
        const idle = (window as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
        const warm = (): void => {
          if (!cancelled) getSeparator().warm();
        };
        if (idle) idle(warm);
        else warm();
      })();
    }, WARM_UP_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Re-armed when a song first loads or the settings change, not on every song.
  }, [song !== null, settings.karaokeWarmUp, settings.karaokeMode]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      streamRef.current?.dispose();
      for (const parked of parkedRef.current) parked.dispose();
      parkedRef.current = [];
      revokeRendered();
    };
  }, [revokeRendered]);

  const setMix = useCallback((next: KaraokeMix): void => updateSettings({ karaokeMix: next }), [updateSettings]);

  const toggle = useCallback(async (): Promise<void> => {
    const current = song;
    if (!current) return;
    // On (including while the AI model is still loading): a press turns it off.
    if (intentRef.current || engineRef.current !== 'off') {
      await stop();
      return;
    }
    await start(current);
  }, [song, start, stop]);

  const dismissMixHint = useCallback((): void => {
    markMixHintSeen();
    setShowMixHint(false);
  }, []);

  const active = engine !== 'off';
  const busy = active && (status === 'loading' || status === 'processing') && (engine === 'ai' || engine === 'rendered' || stage !== null);
  return {
    status,
    backend: engine === 'ai' ? 'roformer' : engine === 'bridge' || engine === 'rendered' ? 'midside' : null,
    active,
    busy,
    stage: busy || status === 'catching-up' ? stage : null,
    error,
    monoWarning,
    block,
    fallbackReason,
    mix,
    setMix,
    supportsMix: engine === 'ai',
    coverage,
    consent,
    answerConsent,
    chooseAiModel,
    showMixHint,
    dismissMixHint,
    announcement,
    toggle,
    clearError: () => setError(null)
  };
}
