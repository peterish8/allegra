/**
 * The DJ's natural voice on the listener's own device: Kokoro-82M through kokoro-js. Free, no key, no
 * server; quantised to 8 bits (about 92 MB), cached by the browser after a first download the listener
 * starts. It sounds far more natural than the operating system's voices; English only.
 */

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const READY_KEY = 'allegra.dj.kokoro.v1';
export const LOCAL_SPEECH_MB = 92;

/** A short, friendly set of Kokoro's best-graded voices. */
export const LOCAL_SPEECH_VOICES = [
  { id: 'af_heart', label: 'Heart · warm' },
  { id: 'af_bella', label: 'Bella · bright' },
  { id: 'am_michael', label: 'Michael · easy' },
  { id: 'bf_emma', label: 'Emma · British' },
  { id: 'bm_george', label: 'George · British' }
] as const;

export type LocalSpeechVoice = (typeof LOCAL_SPEECH_VOICES)[number]['id'];

interface Speaker {
  generate: (text: string, options: { readonly voice: LocalSpeechVoice; readonly speed?: number }) => Promise<{ toBlob: () => Blob }>;
}

let speakerPromise: Promise<Speaker> | null = null;

export function isLocalSpeechReady(): boolean {
  try {
    return window.localStorage.getItem(READY_KEY) === '1';
  } catch {
    return false;
  }
}

export function isLocalSpeechVoice(value: string): value is LocalSpeechVoice {
  return LOCAL_SPEECH_VOICES.some((voice) => voice.id === value);
}

/** Loads (and on the first run downloads) the voice. `onProgress` gets 0..100. */
export async function loadLocalSpeech(onProgress: (percent: number) => void = () => undefined): Promise<void> {
  if (!speakerPromise) {
    speakerPromise = (async () => {
      const { KokoroTTS } = await import('kokoro-js');
      const speaker = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (event: { readonly status?: string; readonly progress?: number }) => {
          if (event.status === 'progress' && typeof event.progress === 'number') onProgress(Math.round(event.progress));
        }
      });
      try {
        window.localStorage.setItem(READY_KEY, '1');
      } catch {
        // It will just ask again next time.
      }
      return speaker as unknown as Speaker;
    })().catch((error: unknown) => {
      speakerPromise = null;
      throw error;
    });
  }
  await speakerPromise;
}

/** One reply as playable audio. */
export async function speakLocally(text: string, voice: LocalSpeechVoice): Promise<Blob> {
  await loadLocalSpeech();
  if (!speakerPromise) throw new Error('The voice is not loaded.');
  const speaker = await speakerPromise;
  const audio = await speaker.generate(text, { voice, speed: 1.05 });
  return audio.toBlob();
}
