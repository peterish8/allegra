/**
 * Speech to text on the listener's own device, through transformers.js: free, no key, no server, in
 * every browser, including the ones whose built-in recogniser has no service behind it (Opera, Brave).
 *
 * The model is Moonshine base (Useful Sensors), quantised to 8 bits, about 63 MB, cached by the browser
 * after the first download, which only happens after the listener says yes. Moonshine reads the audio at
 * its real length, where Whisper pads every request to 30 seconds, so a short spoken request is written
 * down several times faster at a similar accuracy. If it cannot load, Whisper tiny (English) is used.
 */

import { createProgressTracker, type ModelProgressEvent } from './modelProgress';

const MODELS = ['onnx-community/moonshine-base-ONNX', 'Xenova/whisper-tiny.en'] as const;
/** Remembers that a model was downloaded on this browser, so it never asks twice. */
const READY_KEY = 'allegra.dj.ears.v2';
/** About how much the first download is, for the question we ask before it. */
export const LOCAL_VOICE_MB = 63;

type Transcriber = (audio: Float32Array) => Promise<{ readonly text?: string } | readonly { readonly text?: string }[]>;

let transcriberPromise: Promise<Transcriber> | null = null;

export function isLocalVoiceReady(): boolean {
  try {
    return window.localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
}

function markReady(): void {
  try {
    window.localStorage.setItem(READY_KEY, '1');
  } catch {
    // It will just ask again next time.
  }
}

/** Loads (and on the first run downloads) the model. `onProgress` gets 0..100. */
export async function loadLocalVoice(onProgress: (percent: number) => void = () => undefined): Promise<void> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { env, pipeline } = await import('@huggingface/transformers');
      env.useBrowserCache = true;
      let lastError: unknown = null;
      for (const model of MODELS) {
        try {
          const track = createProgressTracker(onProgress);
          const transcriber = await pipeline('automatic-speech-recognition', model, {
            device: 'wasm',
            dtype: 'q8',
            progress_callback: (event: ModelProgressEvent) => track(event)
          });
          markReady();
          return transcriber as unknown as Transcriber;
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError ?? new Error('No speech model could load.');
    })().catch((error: unknown) => {
      transcriberPromise = null;
      throw error;
    });
  }
  await transcriberPromise;
}

/** Transcribes 16 kHz mono audio. Returns '' when nothing intelligible was said. */
export async function transcribeLocally(audio: Float32Array): Promise<string> {
  await loadLocalVoice();
  if (!transcriberPromise) return '';
  const transcriber = await transcriberPromise;
  const result = await transcriber(audio);
  const text = Array.isArray(result) ? result.map((part) => part.text ?? '').join(' ') : (result as { readonly text?: string }).text ?? '';
  // Non-speech comes back as bracketed notes: "[Music]", "(laughs)".
  return text.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}
