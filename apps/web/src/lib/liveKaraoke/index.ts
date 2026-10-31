import { processToInstrumentalBlob } from './processInWorker';
import type { LiveKaraokePrepareResult } from './types';

export type { LiveKaraokeBackend, LiveKaraokePrepareResult, LiveKaraokeStatus } from './types';
export { midSideVocalRemove, audioBufferToWav, audioBufferToBlobUrl } from './midSideVocalRemove';
export { fetchAndDecodeSong, resolveStreamFetchPath, MAX_LIVE_KARAOKE_SECONDS } from './streamFetch';
export { processToInstrumentalBlob } from './processInWorker';
export {
  audioBufferToStereo44k,
  clearRoformerCache,
  clearStemCache,
  ensureRoformerModel,
  existingSeparator,
  getSeparator,
  isRoformerLikelySupported,
  roformerCacheBytes,
  roformerModelOnDevice,
  ROFORMER_MODEL,
  ROFORMER_SAMPLE_RATE,
  stemCacheBytes,
  STEM_CACHE_LIMIT_BYTES,
  type ModelLoadProgress
} from './roformer';
export { ensureBridge, type KaraokeBridge } from './bridge';
export {
  aiBlock,
  blockCopy,
  clearVerdict,
  deviceFacts,
  hasDownloadConsent,
  markKaraokeUsed,
  markMixHintSeen,
  mixHintSeen,
  recordSlowRun,
  saveDownloadConsent,
  saveVerdict,
  storedVerdict,
  usedKaraokeRecently,
  webgpuAvailable,
  type AiBlock
} from './device';
export { LiveKaraokeStream, type StreamSessionEvents } from './streamSession';

export interface MidSideKaraokeInput {
  readonly signal?: AbortSignal;
  readonly midAttenuation?: number;
  readonly bassKeepHz?: number;
  readonly airKeepHz?: number;
  readonly airKeep?: number;
  readonly sideBoost?: number;
  readonly makeupGain?: number;
  /** Why the AI model is not being used, shown to the listener. */
  readonly fallbackReason?: string;
  readonly onProgress?: (ratio: number) => void;
}

/**
 * Basic karaoke for a browser without Web Audio (everywhere else the live bridge does
 * this): a bass-preserving mid-side vocal remover rendered to a blob the player swaps in.
 */
export async function prepareMidSideKaraoke(
  decoded: AudioBuffer,
  input: MidSideKaraokeInput = {}
): Promise<LiveKaraokePrepareResult> {
  const { blobUrl, monoSource } = await processToInstrumentalBlob(
    decoded,
    {
      midAttenuation: input.midAttenuation ?? 0.95,
      bassKeepHz: input.bassKeepHz ?? 200,
      airKeepHz: input.airKeepHz,
      airKeep: input.airKeep,
      sideBoost: input.sideBoost ?? 1.22,
      makeupGain: input.makeupGain ?? 1.08
    },
    input.onProgress,
    input.signal
  );
  return { backend: 'midside', blobUrl, monoSource, fallbackReason: input.fallbackReason };
}
