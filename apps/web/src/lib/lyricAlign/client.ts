import type { LyricsSyncCandidate } from '@shared/lyricSync';
import type { Alignment } from './ctc';
import type { AlignProgress } from './config';
import { resolveApiUrl } from '../api';

export interface AlignedVersion extends Alignment { readonly candidate: LyricsSyncCandidate }

export async function syncInBrowser(streamUrl: string, candidates: LyricsSyncCandidate[], gpu: boolean, signal: AbortSignal, progress: (p: AlignProgress) => void): Promise<AlignedVersion[]> {
  progress({ stage: 'Preparing audio', percent: 0, overall: 0 });
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 120_000);
  let data: ArrayBuffer;
  try {
    const response = await fetch(resolveApiUrl(streamUrl), { signal: AbortSignal.any([signal, timeout.signal]) });
    if (!response.ok) throw new Error('Could not load this recording. Try playing it first, then retry.');
    data = await response.arrayBuffer();
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Could not load the recording.');
  } finally { clearTimeout(timer); }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  const context = new AudioContext({ sampleRate: 16000 });
  let pcm: Float32Array<ArrayBuffer>;
  try {
    const decoded = await context.decodeAudioData(data);
    const length = Math.ceil(decoded.duration * 16000);
    if (decoded.duration > 1200) throw new Error('Choose a recording under 20 minutes to sync on this device.');
    const offline = new OfflineAudioContext(1, length, 16000);
    const source = offline.createBufferSource();
    source.buffer = decoded; source.connect(offline.destination); source.start();
    pcm = new Float32Array((await offline.startRendering()).getChannelData(0));
  } finally { await context.close(); }
  if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./alignWorker.ts', import.meta.url), { type: 'module' });
    const clean = (): void => { signal.removeEventListener('abort', abort); worker.terminate(); };
    const abort = (): void => { clean(); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => { clean(); reject(new Error('The alignment worker stopped. Try CPU mode or another browser.')); };
    worker.onmessage = (event: MessageEvent<{ type: 'progress'; progress: AlignProgress } | { type: 'error'; message: string } | { type: 'done'; versions: AlignedVersion[] }>) => {
      const message = event.data;
      if (message.type === 'progress') progress(message.progress);
      else if (message.type === 'error') { clean(); reject(new Error(message.message)); }
      else { clean(); resolve(message.versions); }
    };
    worker.postMessage({ pcm, candidates, gpu }, [pcm.buffer]);
  });
}
