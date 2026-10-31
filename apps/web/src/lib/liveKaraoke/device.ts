import type { KaraokeMode } from '../settings';
import { ROFORMER_MODEL } from './roformer/config';

/**
 * What this browser knows about running the AI model: whether it was measured too slow,
 * whether the listener agreed to the download, and when karaoke was last used. Device-local
 * on purpose: a laptop's verdict says nothing about a phone signed into the same account.
 */

const KEY = 'allegra-karaoke-device-v1';
/** Warm the model up in idle time only for listeners who used karaoke this recently. */
const WARM_UP_WITHIN_MS = 14 * 24 * 60 * 60 * 1000;

export type Verdict = 'ok' | 'too-slow';

interface DeviceRecord {
  readonly verdict: Verdict | null;
  /** The model the verdict was measured with; another model is measured afresh. */
  readonly verdictModel: string | null;
  readonly consent: boolean;
  readonly lastUsedAt: number;
  readonly mixHintSeen: boolean;
}

const EMPTY: DeviceRecord = { verdict: null, verdictModel: null, consent: false, lastUsedAt: 0, mixHintSeen: false };

function read(): DeviceRecord {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const value = JSON.parse(raw) as Partial<DeviceRecord>;
    return {
      verdict: value.verdict === 'ok' || value.verdict === 'too-slow' ? value.verdict : null,
      verdictModel: typeof value.verdictModel === 'string' ? value.verdictModel : null,
      consent: value.consent === true,
      lastUsedAt: typeof value.lastUsedAt === 'number' ? value.lastUsedAt : 0,
      mixHintSeen: value.mixHintSeen === true
    };
  } catch {
    return EMPTY;
  }
}

function write(patch: Partial<DeviceRecord>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ ...read(), ...patch }));
  } catch {
    // Storage unavailable: the choice holds for this visit only.
  }
}

export function storedVerdict(): Verdict | null {
  const record = read();
  return record.verdictModel === ROFORMER_MODEL.dataSha256 ? record.verdict : null;
}

export function saveVerdict(verdict: Verdict): void {
  write({ verdict, verdictModel: ROFORMER_MODEL.dataSha256 });
}

export function clearVerdict(): void {
  write({ verdict: null, verdictModel: null });
}

/**
 * What to remember after a chunk separated slower than the song plays. A device that
 * already kept up gets a second chance next time (a busy GPU or a hot laptop is no
 * verdict); only a second slow run in a row, or a first one, marks it too slow.
 */
export function verdictAfterSlowRun(previous: Verdict | null): Verdict | null {
  return previous === 'ok' ? null : 'too-slow';
}

export function recordSlowRun(): void {
  const next = verdictAfterSlowRun(storedVerdict());
  if (next) saveVerdict(next);
  else clearVerdict();
}

/**
 * Whether a chunk's separation time says anything about the device. A hidden tab
 * throttles the worker and the GPU, so a chunk that ran while it was hidden is not timed.
 */
export function paceIsMeasurable(hiddenNow: boolean, lastHiddenAt: number, chunkStartedAt: number): boolean {
  return !hiddenNow && lastHiddenAt < chunkStartedAt;
}

export function hasDownloadConsent(): boolean {
  return read().consent;
}

export function saveDownloadConsent(consent: boolean): void {
  write({ consent });
}

export function markKaraokeUsed(): void {
  write({ lastUsedAt: Date.now() });
}

export function usedKaraokeRecently(now = Date.now()): boolean {
  return now - read().lastUsedAt < WARM_UP_WITHIN_MS;
}

export function mixHintSeen(): boolean {
  return read().mixHintSeen;
}

export function markMixHintSeen(): void {
  write({ mixHintSeen: true });
}

/** Why the AI model is not used for this press; null when it is. */
export type AiBlock = 'declined' | 'no-worker' | 'no-webgpu' | 'phone' | 'low-memory' | 'too-slow' | 'save-data';

export interface DeviceFacts {
  readonly mode: KaraokeMode;
  readonly worker: boolean;
  readonly webgpu: boolean;
  readonly mobile: boolean;
  /** `navigator.deviceMemory` in GB, where the browser reports it. */
  readonly deviceMemory: number | null;
  readonly saveData: boolean;
  readonly modelOnDevice: boolean;
  readonly verdict: Verdict | null;
}

/**
 * Decide before downloading 741 MB, not after. Phones and browsers without WebGPU cannot
 * separate as fast as a song plays (an S24 Ultra needs ~16 s per 11 s chunk), so they
 * would download the model only to fall back. "Always AI" in Settings skips every
 * guess except the hard requirement of a worker.
 */
export function aiBlock(facts: DeviceFacts): AiBlock | null {
  if (!facts.worker) return 'no-worker';
  if (facts.mode === 'ai') return null;
  if (!facts.webgpu) return 'no-webgpu';
  if (facts.mobile) return 'phone';
  if (facts.deviceMemory !== null && facts.deviceMemory < 4) return 'low-memory';
  if (facts.verdict === 'too-slow') return 'too-slow';
  if (facts.saveData && !facts.modelOnDevice) return 'save-data';
  return null;
}

interface NavigatorHints {
  readonly gpu?: { requestAdapter(): Promise<unknown> };
  readonly deviceMemory?: number;
  readonly userAgentData?: { readonly mobile?: boolean };
  readonly connection?: { readonly saveData?: boolean };
}

let adapterProbe: Promise<boolean> | null = null;

/** Whether WebGPU hands out an adapter. `'gpu' in navigator` alone is true on machines that then refuse one. */
export function webgpuAvailable(): Promise<boolean> {
  adapterProbe ??= (async () => {
    try {
      const gpu = (navigator as NavigatorHints).gpu;
      return gpu ? (await gpu.requestAdapter()) != null : false;
    } catch {
      return false;
    }
  })();
  return adapterProbe;
}

export function isPhoneOrTablet(): boolean {
  const hints = navigator as NavigatorHints;
  if (typeof hints.userAgentData?.mobile === 'boolean' && hints.userAgentData.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export async function deviceFacts(mode: KaraokeMode, modelOnDevice: boolean): Promise<DeviceFacts> {
  const hints = navigator as NavigatorHints;
  return {
    mode,
    worker: typeof Worker === 'function',
    webgpu: await webgpuAvailable(),
    mobile: isPhoneOrTablet(),
    deviceMemory: typeof hints.deviceMemory === 'number' ? hints.deviceMemory : null,
    saveData: hints.connection?.saveData === true,
    modelOnDevice,
    verdict: storedVerdict()
  };
}

/** Listener-facing copy for each reason, with the step that would change it. */
export function blockCopy(block: AiBlock): { readonly summary: string; readonly detail: string } {
  switch (block) {
    case 'declined':
      return {
        summary: 'Light remover',
        detail: 'You postponed the AI model download. Choose the AI model in Settings to ask again. The light remover keeps playing in the meantime.'
      };
    case 'no-worker':
    case 'no-webgpu':
      return {
        summary: 'Light remover · no GPU access',
        detail: 'This browser can’t give the AI model GPU access (WebGPU), so it would separate slower than the song plays. Allegra uses the light remover instead. A recent Chrome or Edge on a computer runs the AI model.'
      };
    case 'phone':
      return {
        summary: 'Light remover on phones',
        detail: 'Phones separate slower than a song plays, so the AI model would leave most of the song with vocals. Allegra uses the light remover here. Choose “Always AI” in Settings to try the model anyway.'
      };
    case 'low-memory':
      return {
        summary: 'Light remover · low memory',
        detail: 'The AI model needs about 2 GB of memory and this device reports less. Allegra uses the light remover. Choose “Always AI” in Settings to try anyway.'
      };
    case 'too-slow':
      return {
        summary: 'Light remover · device too slow',
        detail: 'This device separated slower than the song plays last time, so Allegra uses the light remover. Choose “Always AI” in Settings, or try again from Settings after a browser update.'
      };
    case 'save-data':
      return {
        summary: 'Light remover · Data Saver',
        detail: 'Data Saver is on, so Allegra won’t download the 752 MB AI model. Turn Data Saver off, or choose “Always AI” in Settings, to use it.'
      };
  }
}
