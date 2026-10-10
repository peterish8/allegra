import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { requestDjSpeech, requestDjTranscription, type DjEarsCloudProvider, type DjVoiceCloudProvider } from '../lib/api';
import { SPEECH_RATE, createUtteranceDetector, encodeWav, resampleTo16k, toBase64 } from '../lib/djSpeechCapture';
import { isLocalSpeechReady, isLocalSpeechVoice, loadLocalSpeech, speakLocally } from '../lib/djLocalSpeech';
import { isLocalVoiceReady, loadLocalVoice, transcribeLocally } from '../lib/djWhisper';

/**
 * Talking to the DJ, and the DJ talking back. Every part has a free path and a bring-your-own-key path:
 *
 *  Ears (speech to text)
 *   - browser: the Web Speech API. Chrome 142+ on the desktop recognises on the device once its free
 *     language pack is installed; other browsers use their own speech service.
 *   - local: Moonshine (or Whisper tiny) on this device, through transformers.js. Free, no key, any
 *     browser; it is the default where the browser has no working recogniser (Opera, Brave, Firefox).
 *   - openai / groq: the listener's own key, through Allegra's API (`/api/ai/dj/transcribe`).
 *  Voice (text to speech)
 *   - browser: the operating system's voices (speechSynthesis). Free, no key.
 *   - kokoro: Kokoro-82M on this device, a natural voice. Free, no key, a one-time ~92 MB download.
 *   - openai / elevenlabs: the listener's own key, through `/api/ai/dj/speak`.
 *
 * "Hey DJ" listens continuously, so it runs only where nothing leaves the device: on-device Web Speech,
 * or local Whisper over short utterances. Keys live in memory only; the choices are remembered.
 */

type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface RecognitionAlternative { readonly transcript: string }
interface RecognitionResult { readonly isFinal: boolean; readonly length: number; readonly [index: number]: RecognitionAlternative }
interface RecognitionEvent { readonly resultIndex: number; readonly results: { readonly length: number; readonly [index: number]: RecognitionResult } }
interface RecognitionErrorEvent { readonly error: string }
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
interface RecognitionOptions { readonly langs: readonly string[]; readonly processLocally: boolean }
interface RecognitionConstructor {
  new (): Recognition;
  available?: (options: RecognitionOptions) => Promise<Availability>;
  install?: (options: RecognitionOptions) => Promise<boolean>;
}
interface SpeechWindow extends Window {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
}

export type DjEarsChoice = 'auto' | 'browser' | 'local' | DjEarsCloudProvider;
export type DjVoiceChoice = 'off' | 'browser' | 'kokoro' | DjVoiceCloudProvider;
/** Where the microphone stands: not asked yet, allowed, blocked, or impossible on this page. */
export type DjMicState = 'unknown' | 'prompt' | 'granted' | 'denied' | 'insecure' | 'none';
/** What `listen()` will actually use right now. */
export type DjEarsEngine = 'device' | 'browser' | 'local' | 'cloud' | 'none';

export interface DjVoiceSettings {
  readonly ears: DjEarsChoice;
  readonly earsModel: string;
  readonly voice: DjVoiceChoice;
  readonly voiceModel: string;
  readonly voiceName: string;
}

export interface DjVoice {
  readonly engine: DjEarsEngine;
  readonly settings: DjVoiceSettings;
  readonly setSettings: (next: Partial<DjVoiceSettings>) => void;
  readonly earsKey: string;
  readonly setEarsKey: (key: string) => void;
  readonly voiceKey: string;
  readonly setVoiceKey: (key: string) => void;
  /** This browser's own recogniser can work here (not Opera or Brave, which ship it without a service). */
  readonly browserEars: boolean;
  /** Chrome's on-device language pack can be installed (free, once). */
  readonly canInstall: boolean;
  readonly installing: boolean;
  readonly installDevice: () => Promise<void>;
  /** Local Whisper: downloaded already; the download in progress (0..100); a request is waiting on a yes. */
  readonly localReady: boolean;
  readonly localProgress: number | null;
  readonly needsLocalDownload: boolean;
  readonly downloadLocal: () => Promise<void>;
  readonly dismissDownload: () => void;
  readonly listening: boolean;
  readonly transcribing: boolean;
  readonly transcript: string;
  readonly wakeOn: boolean;
  /** "Hey DJ" can run with the current ears. */
  readonly wakeAvailable: boolean;
  readonly error: string | null;
  readonly listen: () => void;
  readonly stop: () => void;
  readonly setWake: (on: boolean) => void;
  readonly micState: DjMicState;
  /** The natural on-device voice: downloaded already, and the download in progress (0..100). */
  readonly speechReady: boolean;
  readonly speechProgress: number | null;
  readonly downloadSpeech: () => Promise<void>;
  readonly speaking: boolean;
  /** Says a DJ reply out loud with the chosen voice (nothing when the voice is off). */
  readonly speak: (text: string) => void;
  readonly stopSpeaking: () => void;
}

export interface DjVoiceOptions {
  /** Every finished spoken request. */
  readonly onCommand: (text: string) => void;
  /** Lowers the music while the DJ speaks (true) and brings it back (false). */
  readonly onDuck?: (ducked: boolean) => void;
}

const LANGS = ['en-IN', 'en-US'] as const;
const SETTINGS_KEY = 'allegra.dj.voice.v1';
const WAKE_STORAGE_KEY = 'allegra.dj.wake.v1';
/** "hey DJ", "ok DJ", "hi deejay"… and what follows it is the request. */
const WAKE = /\b(?:hey|hi|okay|ok|yo)\s*,?\s+(?:dj|d\.?\s?j\.?|deejay|d j)\b[\s,.!]*/i;
/** After the wake phrase alone, a request must start within this long. */
const FOLLOW_UP_MS = 6000;
/** A recogniser that keeps ending (no mic, no network) is retried at most this often. */
const RESTART_GAP_MS = 600;
/** Local "Hey DJ": an utterance longer than this is music or talk in the room, not a wake phrase. */
const WAKE_MAX_MS = 4500;
const DEFAULT_SETTINGS: DjVoiceSettings = { ears: 'auto', earsModel: '', voice: 'browser', voiceModel: '', voiceName: '' };
const EARS_CHOICES: readonly DjEarsChoice[] = ['auto', 'browser', 'local', 'openai', 'groq'];
const VOICE_CHOICES: readonly DjVoiceChoice[] = ['off', 'browser', 'kokoro', 'openai', 'elevenlabs'];

function recognitionClass(): RecognitionConstructor | null {
  if (typeof window === 'undefined') return null;
  const speechWindow = window as SpeechWindow;
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

/** Opera and Brave expose the recogniser but have no speech service behind it: every attempt fails. */
function browserRecogniserWorks(): boolean {
  if (typeof navigator === 'undefined' || !recognitionClass()) return false;
  if (/\bOPR\/|\bOpera\b/.test(navigator.userAgent)) return false;
  if ('brave' in navigator) return false;
  return true;
}

function canRecord(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && typeof AudioContext !== 'undefined';
}

function readSettings(): DjVoiceSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_SETTINGS;
    const record = parsed as Record<string, unknown>;
    const text = (value: unknown): string => (typeof value === 'string' ? value.slice(0, 120) : '');
    return {
      ears: EARS_CHOICES.includes(record.ears as DjEarsChoice) ? record.ears as DjEarsChoice : 'auto',
      earsModel: text(record.earsModel),
      voice: VOICE_CHOICES.includes(record.voice as DjVoiceChoice) ? record.voice as DjVoiceChoice : 'browser',
      voiceModel: text(record.voiceModel),
      voiceName: text(record.voiceName)
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function store(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The choice is just not remembered.
  }
}

/** How to unblock the microphone, in the words of the browser's own controls. */
export const MIC_BLOCKED_COPY = 'Your browser is blocking the microphone for Allegra. Click the icon at the left of the address bar, open Site settings (or Permissions), set Microphone to Allow, then press Try again.';
export const MIC_INSECURE_COPY = 'Browsers only allow the microphone on a secure page. Open Allegra at its https:// address (or http://localhost on this computer) to talk to your DJ.';

function errorCopy(code: string): string | null {
  if (code === 'not-allowed' || code === 'NotAllowedError' || code === 'SecurityError') return MIC_BLOCKED_COPY;
  if (code === 'audio-capture' || code === 'NotFoundError' || code === 'NotReadableError') return 'No working microphone was found. Check that one is plugged in and not used by another app, then press Try again.';
  return null;
}

/**
 * Records one spoken request from the microphone and returns it at 16 kHz, or null when nobody spoke.
 * Echo cancellation keeps the music the page is playing out of it.
 */
async function captureUtterance(options: { readonly signal: AbortSignal; readonly waitMs: number; readonly maxMs: number }): Promise<{ readonly audio: Float32Array; readonly cut: boolean } | null> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but works in every browser without a separate worklet file.
  const processor = context.createScriptProcessor(4096, 1, 1);
  const sink = context.createGain();
  sink.gain.value = 0;
  source.connect(processor);
  processor.connect(sink);
  sink.connect(context.destination);
  const detector = createUtteranceDetector({ sampleRate: context.sampleRate, waitMs: options.waitMs, maxMs: options.maxMs });

  return new Promise((resolve) => {
    let finished = false;
    const finish = (keep: boolean): void => {
      if (finished) return;
      finished = true;
      processor.onaudioprocess = null;
      source.disconnect();
      processor.disconnect();
      sink.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
      options.signal.removeEventListener('abort', onAbort);
      if (!keep || detector.spokenMs() < 300) {
        resolve(null);
        return;
      }
      resolve({ audio: resampleTo16k(detector.take(), context.sampleRate), cut: detector.spokenMs() >= options.maxMs - 150 });
    };
    const onAbort = (): void => finish(true);
    options.signal.addEventListener('abort', onAbort);
    processor.onaudioprocess = (event) => {
      const state = detector.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      if (state === 'done') finish(true);
      else if (state === 'silent') finish(false);
    };
  });
}

export const DjVoiceContext = createContext<DjVoice | null>(null);

export function useDjVoice(): DjVoice | null {
  return useContext(DjVoiceContext);
}

export function useDjVoiceState({ onCommand, onDuck }: DjVoiceOptions): DjVoice {
  const commandRef = useRef(onCommand);
  commandRef.current = onCommand;
  const duckRef = useRef(onDuck);
  duckRef.current = onDuck;

  const [settings, setSettingsState] = useState<DjVoiceSettings>(DEFAULT_SETTINGS);
  const [earsKey, setEarsKey] = useState('');
  const [voiceKey, setVoiceKey] = useState('');
  const [browserEars, setBrowserEars] = useState(false);
  const [deviceEars, setDeviceEars] = useState(false);
  const [lang, setLang] = useState<string>(LANGS[0]);
  const [canInstall, setCanInstall] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [localReady, setLocalReady] = useState(false);
  const [localProgress, setLocalProgress] = useState<number | null>(null);
  const [needsLocalDownload, setNeedsLocalDownload] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [wakeOn, setWakeOn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState(false);
  /** The browser's recogniser failed at runtime (no service): fall back to local Whisper. */
  const [browserFailed, setBrowserFailed] = useState(false);
  const [micState, setMicState] = useState<DjMicState>('unknown');
  const [speechReady, setSpeechReady] = useState(false);
  const [speechProgress, setSpeechProgress] = useState<number | null>(null);

  // What this browser can do.
  useEffect(() => {
    setSettingsState(readSettings());
    setLocalReady(isLocalVoiceReady());
    setSpeechReady(isLocalSpeechReady());
    // The microphone needs a secure page, and the browser remembers a yes or no per site.
    let permission: PermissionStatus | null = null;
    const readPermission = (): void => { if (permission) setMicState(permission.state === 'granted' ? 'granted' : permission.state === 'denied' ? 'denied' : 'prompt'); };
    if (!window.isSecureContext) setMicState('insecure');
    else if (!navigator.mediaDevices?.getUserMedia) setMicState('none');
    else if (navigator.permissions?.query) {
      void navigator.permissions.query({ name: 'microphone' as PermissionName }).then((status) => {
        permission = status;
        readPermission();
        status.onchange = readPermission;
      }).catch(() => setMicState('prompt'));
    } else setMicState('prompt');
    const works = browserRecogniserWorks();
    setBrowserEars(works);
    const Recognizer = recognitionClass();
    let cancelled = false;
    if (works && Recognizer?.available) {
      void (async () => {
        for (const candidate of LANGS) {
          try {
            const state = await Recognizer.available?.({ langs: [candidate], processLocally: true });
            if (cancelled) return;
            if (state === 'available') {
              setLang(candidate);
              setDeviceEars(true);
              setCanInstall(false);
              return;
            }
            if (state === 'downloadable' || state === 'downloading') {
              setLang(candidate);
              setCanInstall(true);
              return;
            }
          } catch {
            // Try the next language.
          }
        }
      })();
    }
    try {
      if (window.localStorage.getItem(WAKE_STORAGE_KEY) === '1') setWakeOn(true);
    } catch {
      // Not remembered.
    }
    return () => {
      cancelled = true;
      if (permission) permission.onchange = null;
    };
  }, []);

  const engine: DjEarsEngine = useMemo(() => {
    const choice = settings.ears;
    if (choice === 'openai' || choice === 'groq') return 'cloud';
    if (choice === 'local') return canRecord() ? 'local' : 'none';
    if (choice === 'browser') return browserEars ? (deviceEars ? 'device' : 'browser') : 'none';
    // auto: the browser's own recogniser where it works, Whisper on the device everywhere else.
    if (browserEars && !browserFailed) return deviceEars ? 'device' : 'browser';
    return canRecord() ? 'local' : 'none';
  }, [browserEars, browserFailed, deviceEars, settings.ears]);

  const wakeAvailable = engine === 'device' || engine === 'local';

  const setSettings = useCallback((next: Partial<DjVoiceSettings>): void => {
    setSettingsState((current) => {
      const merged = { ...current, ...next };
      store(SETTINGS_KEY, JSON.stringify(merged));
      return merged;
    });
    setError(null);
  }, []);

  const recognitionRef = useRef<Recognition | null>(null);
  const captureRef = useRef<AbortController | null>(null);
  const wakeAbortRef = useRef<AbortController | null>(null);
  const wakeRecognitionRef = useRef<Recognition | null>(null);
  const wakeWantedRef = useRef(false);
  const lastWakeStartRef = useRef(0);
  const followUntilRef = useRef(0);
  const speakingRef = useRef(false);
  const startWakeRef = useRef<() => void>(() => undefined);
  const busyRef = useRef(false);

  const deliver = useCallback((raw: string): void => {
    const request = raw.replace(WAKE, '').trim();
    if (request.length > 1) commandRef.current(request);
  }, []);

  /** Writes down recorded audio with the local or cloud ears. */
  const writeDown = useCallback(async (audio: Float32Array, via: 'local' | 'cloud'): Promise<string> => {
    if (via === 'local') return transcribeLocally(audio);
    const provider = settings.ears === 'groq' ? 'groq' : 'openai';
    const result = await requestDjTranscription({
      provider,
      apiKey: earsKey.trim(),
      ...(settings.earsModel.trim() ? { model: settings.earsModel.trim() } : {}),
      audio: toBase64(encodeWav(audio, SPEECH_RATE))
    });
    return result.text;
  }, [earsKey, settings.ears, settings.earsModel]);

  const stopWake = useCallback((): void => {
    wakeAbortRef.current?.abort();
    wakeAbortRef.current = null;
    const recognition = wakeRecognitionRef.current;
    wakeRecognitionRef.current = null;
    if (recognition) {
      recognition.onend = null;
      recognition.abort();
    }
  }, []);

  const listenWithBrowser = useCallback((): void => {
    const Recognizer = recognitionClass();
    if (!Recognizer) return;
    const recognition = new Recognizer();
    recognition.lang = lang;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    if (engine === 'device') recognition.processLocally = true;
    let heard = '';
    recognition.onresult = (event) => {
      let text = '';
      let final = false;
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result) continue;
        text += result[0]?.transcript ?? '';
        if (result.isFinal) final = true;
      }
      heard = text.trim();
      setTranscript(heard);
      setMicState('granted');
      if (final) recognition.stop();
    };
    recognition.onerror = (event) => {
      const copy = errorCopy(event.error);
      if (copy) {
        if (event.error === 'not-allowed') setMicState('denied');
        setError(copy);
      } else if (event.error === 'service-not-allowed' || event.error === 'network' || event.error === 'language-not-supported') {
        // This browser's recogniser has no service behind it: Whisper on the device takes over.
        setBrowserFailed(true);
        setError('This browser’s speech service isn’t answering, so your DJ will listen on this device instead. Tap the mic again.');
      }
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      busyRef.current = false;
      setListening(false);
      setTranscript('');
      deliver(heard);
      if (wakeWantedRef.current) startWakeRef.current();
    };
    recognitionRef.current = recognition;
    busyRef.current = true;
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      busyRef.current = false;
      setListening(false);
    }
  }, [deliver, engine, lang]);

  const listenWithRecorder = useCallback(async (via: 'local' | 'cloud'): Promise<void> => {
    const controller = new AbortController();
    captureRef.current = controller;
    busyRef.current = true;
    setListening(true);
    try {
      const captured = await captureUtterance({ signal: controller.signal, waitMs: 8000, maxMs: 12_000 });
      setMicState('granted');
      setListening(false);
      if (!captured) return;
      setTranscribing(true);
      setTranscript('…');
      deliver(await writeDown(captured.audio, via));
    } catch (failure) {
      const name = failure instanceof Error ? failure.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') setMicState('denied');
      setError(errorCopy(name) ?? (failure instanceof Error && via === 'cloud' ? failure.message : 'Your voice couldn’t be written down just now. Try again or type it.'));
    } finally {
      captureRef.current = null;
      busyRef.current = false;
      setListening(false);
      setTranscribing(false);
      setTranscript('');
      if (wakeWantedRef.current) startWakeRef.current();
    }
  }, [deliver, writeDown]);

  const listen = useCallback((): void => {
    if (busyRef.current) return;
    setError(null);
    if (micState === 'insecure') {
      setError(MIC_INSECURE_COPY);
      return;
    }
    if (engine === 'none' || micState === 'none') {
      setError('Voice isn’t available in this browser. Type your request instead.');
      return;
    }
    if (engine === 'cloud' && !earsKey.trim()) {
      setError(`Add your ${settings.ears === 'groq' ? 'Groq' : 'OpenAI'} key under Voice in the DJ’s settings, or pick a free option there.`);
      return;
    }
    if (engine === 'local' && !localReady) {
      setNeedsLocalDownload(true);
      return;
    }
    stopWake();
    if (engine === 'device' || engine === 'browser') listenWithBrowser();
    else void listenWithRecorder(engine === 'local' ? 'local' : 'cloud');
  }, [earsKey, engine, listenWithBrowser, listenWithRecorder, localReady, micState, settings.ears, stopWake]);

  const stop = useCallback((): void => {
    recognitionRef.current?.stop();
    captureRef.current?.abort();
  }, []);

  const downloadLocal = useCallback(async (): Promise<void> => {
    setNeedsLocalDownload(false);
    setLocalProgress(0);
    setError(null);
    try {
      await loadLocalVoice((percent) => setLocalProgress((current) => Math.max(current ?? 0, percent)));
      setLocalReady(true);
      setLocalProgress(null);
      void listenWithRecorder('local');
    } catch {
      setLocalProgress(null);
      setError('The voice model couldn’t be downloaded. Check your connection and try again.');
    }
  }, [listenWithRecorder]);

  const dismissDownload = useCallback((): void => setNeedsLocalDownload(false), []);

  // "Hey DJ" with the browser's on-device recogniser.
  const startDeviceWake = useCallback((): void => {
    const Recognizer = recognitionClass();
    if (!Recognizer) return;
    const since = performance.now() - lastWakeStartRef.current;
    if (since < RESTART_GAP_MS) {
      window.setTimeout(() => startWakeRef.current(), RESTART_GAP_MS - since);
      return;
    }
    const recognition = new Recognizer();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.processLocally = true;
    lastWakeStartRef.current = performance.now();
    recognition.onresult = (event) => {
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result?.isFinal || speakingRef.current) continue;
        const text = (result[0]?.transcript ?? '').trim();
        const wake = text.match(WAKE);
        if (wake && wake.index !== undefined) {
          const request = text.slice(wake.index + wake[0].length).trim();
          if (request.length > 1) {
            commandRef.current(request);
          } else {
            followUntilRef.current = Date.now() + FOLLOW_UP_MS;
            stopWake();
            listenWithBrowser();
            return;
          }
        } else if (Date.now() < followUntilRef.current && text) {
          followUntilRef.current = 0;
          commandRef.current(text);
        }
      }
    };
    recognition.onerror = (event) => {
      const copy = errorCopy(event.error);
      if (copy) {
        wakeWantedRef.current = false;
        setWakeOn(false);
        store(WAKE_STORAGE_KEY, '0');
        setError(copy);
      }
    };
    recognition.onend = () => {
      wakeRecognitionRef.current = null;
      startWakeRef.current();
    };
    wakeRecognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      wakeRecognitionRef.current = null;
    }
  }, [lang, listenWithBrowser, stopWake]);

  // "Hey DJ" with Whisper on the device: short utterances only, written down locally, never sent anywhere.
  const startLocalWake = useCallback((): void => {
    const controller = new AbortController();
    wakeAbortRef.current = controller;
    void (async () => {
      while (!controller.signal.aborted && wakeWantedRef.current) {
        if (speakingRef.current || busyRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          continue;
        }
        try {
          const captured = await captureUtterance({ signal: controller.signal, waitMs: 60_000, maxMs: WAKE_MAX_MS });
          if (controller.signal.aborted || !captured || captured.cut) continue;
          const text = await transcribeLocally(captured.audio);
          const wake = text.match(WAKE);
          if (wake && wake.index !== undefined) {
            const request = text.slice(wake.index + wake[0].length).trim();
            if (request.length > 1) commandRef.current(request);
            else {
              wakeAbortRef.current = null;
              void listenWithRecorder('local');
              return;
            }
          }
        } catch (failure) {
          const copy = errorCopy(failure instanceof Error ? failure.name : '');
          if (copy) {
            wakeWantedRef.current = false;
            setWakeOn(false);
            store(WAKE_STORAGE_KEY, '0');
            setError(copy);
            return;
          }
          await new Promise((resolve) => window.setTimeout(resolve, RESTART_GAP_MS));
        }
      }
    })();
  }, [listenWithRecorder]);

  const startWake = useCallback((): void => {
    if (!wakeWantedRef.current || wakeRecognitionRef.current || wakeAbortRef.current || busyRef.current) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (engine === 'device') startDeviceWake();
    else if (engine === 'local' && localReady) startLocalWake();
  }, [engine, localReady, startDeviceWake, startLocalWake]);
  startWakeRef.current = startWake;

  // Armed only while "Hey DJ" is on, the ears allow it, and the page is visible.
  useEffect(() => {
    wakeWantedRef.current = wakeOn && wakeAvailable;
    if (!wakeOn || !wakeAvailable) return undefined;
    startWake();
    const onVisibility = (): void => {
      if (document.hidden) stopWake();
      else startWakeRef.current();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      stopWake();
    };
  }, [startWake, stopWake, wakeAvailable, wakeOn]);

  useEffect(() => () => {
    recognitionRef.current?.abort();
    captureRef.current?.abort();
    stopWake();
  }, [stopWake]);

  const setWake = useCallback((on: boolean): void => {
    if (on && !wakeAvailable) {
      setError(engine === 'cloud'
        ? '“Hey DJ” listens all the time, so it only runs with voice on this device. Pick “On this device” under Voice.'
        : '“Hey DJ” needs voice on this device. Pick “On this device” under Voice, or tap the mic.');
      return;
    }
    if (on && engine === 'local' && !localReady) {
      setNeedsLocalDownload(true);
      return;
    }
    setError(null);
    setWakeOn(on);
    store(WAKE_STORAGE_KEY, on ? '1' : '0');
    if (!on) stopWake();
  }, [engine, localReady, stopWake, wakeAvailable]);

  const installDevice = useCallback(async (): Promise<void> => {
    const Recognizer = recognitionClass();
    if (!Recognizer?.install) return;
    setInstalling(true);
    setError(null);
    try {
      const done = await Recognizer.install({ langs: [lang], processLocally: true });
      if (done) {
        setDeviceEars(true);
        setCanInstall(false);
      } else {
        setError('The voice pack couldn’t be installed. Voice still works through the browser.');
      }
    } catch {
      setError('The voice pack couldn’t be installed. Voice still works through the browser.');
    } finally {
      setInstalling(false);
    }
  }, [lang]);

  const downloadSpeech = useCallback(async (): Promise<void> => {
    setSpeechProgress(0);
    setError(null);
    try {
      await loadLocalSpeech((percent) => setSpeechProgress((current) => Math.max(current ?? 0, percent)));
      setSpeechReady(true);
    } catch {
      setError('The natural voice couldn’t be downloaded. Your DJ will use the browser’s voice for now.');
    } finally {
      setSpeechProgress(null);
    }
  }, []);

  // ---------- The DJ's voice ----------
  const playerRef = useRef<HTMLAudioElement | null>(null);
  const speakRun = useRef(0);

  const finishSpeaking = useCallback((): void => {
    speakingRef.current = false;
    setSpeaking(false);
    duckRef.current?.(false);
  }, []);

  const stopSpeaking = useCallback((): void => {
    speakRun.current += 1;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    playerRef.current?.pause();
    playerRef.current = null;
    finishSpeaking();
  }, [finishSpeaking]);

  const speak = useCallback((raw: string): void => {
    const text = raw.replace(/[“”"]/g, '').trim().slice(0, 600);
    if (!text || settings.voice === 'off') return;
    stopSpeaking();
    const run = speakRun.current;
    const begin = (): void => {
      speakingRef.current = true;
      setSpeaking(true);
      duckRef.current?.(true);
    };
    const playBlob = async (blob: Blob): Promise<void> => {
      if (run !== speakRun.current) return;
      const url = URL.createObjectURL(blob);
      const player = new Audio(url);
      playerRef.current = player;
      const done = (): void => {
        URL.revokeObjectURL(url);
        if (run === speakRun.current) finishSpeaking();
      };
      player.onended = done;
      player.onerror = done;
      begin();
      await player.play();
    };
    // The natural voice, once downloaded; until then the browser's voice stands in.
    if (settings.voice === 'kokoro' && speechReady) {
      void (async () => {
        try {
          await playBlob(await speakLocally(text, isLocalSpeechVoice(settings.voiceName) ? settings.voiceName : 'af_heart'));
        } catch {
          if (run === speakRun.current) finishSpeaking();
        }
      })();
      return;
    }
    if (settings.voice === 'browser' || settings.voice === 'kokoro') {
      if (!('speechSynthesis' in window)) return;
      const utterance = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred = settings.voice === 'browser' && settings.voiceName ? voices.find((voice) => voice.name === settings.voiceName) : undefined;
      const english = voices.find((voice) => voice.lang === 'en-IN') ?? voices.find((voice) => voice.lang.startsWith('en') && voice.localService) ?? voices.find((voice) => voice.lang.startsWith('en'));
      const chosen = preferred ?? english;
      if (chosen) utterance.voice = chosen;
      utterance.rate = 1.03;
      utterance.onend = () => { if (run === speakRun.current) finishSpeaking(); };
      utterance.onerror = () => { if (run === speakRun.current) finishSpeaking(); };
      begin();
      window.speechSynthesis.speak(utterance);
      return;
    }
    if (!voiceKey.trim()) {
      setError(`Add your ${settings.voice === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'} key under Voice in the DJ’s settings, or pick the browser’s voice.`);
      return;
    }
    const provider: DjVoiceCloudProvider = settings.voice === 'elevenlabs' ? 'elevenlabs' : 'openai';
    void (async () => {
      try {
        const result = await requestDjSpeech({
          provider,
          apiKey: voiceKey.trim(),
          ...(settings.voiceModel.trim() ? { model: settings.voiceModel.trim() } : {}),
          ...(settings.voiceName.trim() ? { voice: settings.voiceName.trim() } : {}),
          text
        });
        if (run !== speakRun.current) return;
        const player = new Audio(`data:${result.mime};base64,${result.audio}`);
        playerRef.current = player;
        player.onended = () => { if (run === speakRun.current) finishSpeaking(); };
        player.onerror = () => { if (run === speakRun.current) finishSpeaking(); };
        begin();
        await player.play();
      } catch (failure) {
        if (run !== speakRun.current) return;
        finishSpeaking();
        setError(failure instanceof Error ? failure.message : 'Your DJ couldn’t find its voice just now.');
      }
    })();
  }, [finishSpeaking, settings.voice, settings.voiceModel, settings.voiceName, speechReady, stopSpeaking, voiceKey]);

  return useMemo<DjVoice>(() => ({
    engine, settings, setSettings, earsKey, setEarsKey, voiceKey, setVoiceKey, browserEars,
    canInstall, installing, installDevice,
    localReady, localProgress, needsLocalDownload, downloadLocal, dismissDownload,
    listening, transcribing, transcript, wakeOn, wakeAvailable, error,
    listen, stop, setWake, micState, speechReady, speechProgress, downloadSpeech, speaking, speak, stopSpeaking
  }), [
    micState, speechReady, speechProgress, downloadSpeech,
    browserEars, canInstall, dismissDownload, downloadLocal, earsKey, engine, error, installDevice, installing,
    listen, listening, localProgress, localReady, needsLocalDownload, setSettings, setWake, settings, speak, speaking,
    stop, stopSpeaking, transcribing, transcript, voiceKey, wakeAvailable, wakeOn
  ]);
}
