import { Brain, Cpu, Ear, ExternalLink, ListRestart, LoaderCircle, Mic, Volume2, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState, type Ref } from 'react';

import type { DjEarsChoice, DjVoice, DjVoiceChoice } from '../../hooks/useDjVoice';
import { listCustomModels, normalizeEndpoint, suggestedModel, testCustomModel } from '../../lib/djCustom';
import { LOCAL_SPEECH_MB, LOCAL_SPEECH_VOICES } from '../../lib/djLocalSpeech';
import { DJ_KEY_PAGES, DJ_OPENAI_VOICES, DJ_THINKING_MODELS, type DjBrain, type DjModelOption } from '../../lib/djSession';
import { LOCAL_VOICE_MB } from '../../lib/djWhisper';
import { DjModelPicker } from './DjModelPicker';
import { DjSelect } from './DjSelect';

/** A password field for one provider's key, with a link to the page that hands keys out (none for a custom endpoint). */
function KeyField({ provider, value, onChange }: { readonly provider: keyof typeof DJ_KEY_PAGES | 'custom'; readonly value: string; readonly onChange: (key: string) => void }) {
  const page = provider === 'custom' ? null : DJ_KEY_PAGES[provider];
  return (
    <label className="dj-key-field">
      <span className="dj-key-label">{page ? 'API key' : 'API key · if your endpoint asks for one'}
        {page ? <a href={page.url} target="_blank" rel="noopener noreferrer" className="dj-key-link">Get one at {page.name}<ExternalLink size={11} aria-hidden="true" /></a> : null}
      </span>
      <input
        type="password"
        autoComplete="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={512}
        placeholder={page ? `Paste your ${page.name === 'Google AI Studio' ? 'Gemini' : page.name} key` : 'Paste the endpoint’s key'}
      />
    </label>
  );
}

/**
 * Any OpenAI-compatible endpoint (OmniRoute on this computer, a self-hosted router): its URL, a model
 * from its own list, and an optional key. The browser calls it directly, so it must allow this site.
 */
function CustomEndpointFields({ endpoint, model, apiKey, onEndpoint, onModel, onApiKey }: {
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey: string;
  readonly onEndpoint: (endpoint: string) => void;
  readonly onModel: (model: string) => void;
  readonly onApiKey: (key: string) => void;
}) {
  const [models, setModels] = useState<readonly DjModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState('');
  const usable = normalizeEndpoint(endpoint);
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const latest = useRef({ model, apiKey, onModel });
  latest.current = { model, apiKey, onModel };

  // A saved or freshly typed endpoint fills the model list by itself (half a second after typing
  // stops); a failure stays quiet here, and "Load models" shows the reason.
  useEffect(() => {
    if (!usable) return undefined;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      listCustomModels(usable, latest.current.apiKey.trim(), controller.signal).then((ids) => {
        setModels(ids.map((id) => ({ id, label: id, note: '' })));
        const start = suggestedModel(ids);
        const { model: current, onModel: choose } = latest.current;
        if (start && (!current || !ids.includes(current))) choose(start);
      }).catch(() => undefined);
    }, 500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [usable]);

  const loadModels = async (): Promise<void> => {
    if (!usable || loading) return;
    setLoading(true);
    setNote('');
    try {
      const ids = await listCustomModels(usable, apiKey.trim());
      setModels(ids.map((id) => ({ id, label: id, note: '' })));
      setNote(ids.length ? `${ids.length} models found. Pick one above (type to search).` : 'The endpoint listed no models. Type a model ID instead.');
      const start = suggestedModel(ids);
      if (start && (!model || !ids.includes(model))) onModel(start);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'Couldn’t load the models.');
    } finally {
      setLoading(false);
    }
  };

  const [testing, setTesting] = useState(false);
  const testModel = async (): Promise<void> => {
    if (!usable || !model.trim() || testing) return;
    setTesting(true);
    setNote(`Testing ${model}…`);
    try {
      const ms = await testCustomModel(usable, apiKey.trim(), model.trim());
      setNote(`${model} works · answered in ${(ms / 1000).toFixed(1)} s.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : 'That model didn’t answer.');
    } finally {
      setTesting(false);
    }
  };

  return <>
    <label className="dj-key-field">Endpoint URL
      <input
        value={endpoint}
        onChange={(event) => onEndpoint(event.target.value)}
        maxLength={300}
        placeholder="http://localhost:20128/v1"
        spellCheck={false}
        autoComplete="off"
        inputMode="url"
        aria-invalid={endpoint.trim() !== '' && !usable}
      />
    </label>
    {endpoint.trim() && !usable ? <p className="dj-provider-note dj-mic-line is-warning">Use https://, or http:// on this computer (localhost). The OpenAI-compatible base usually ends in /v1.</p> : null}
    <DjModelPicker key={`custom-${models.length}`} label="Model" value={model} options={models} onChange={onModel} maxLength={160} placeholder="Model ID, e.g. from its dashboard" />
    <div className="dj-load-models">
      <button type="button" className="dj-chip-button" onClick={() => void loadModels()} disabled={!usable || loading}>
        {loading ? <LoaderCircle size={14} aria-hidden="true" className="dj-spin" /> : <ListRestart size={14} aria-hidden="true" />}
        {loading ? 'Loading models…' : 'Load models'}
      </button>
      <button type="button" className="dj-chip-button" onClick={() => void testModel()} disabled={!usable || !model.trim() || testing}>
        {testing ? <LoaderCircle size={14} aria-hidden="true" className="dj-spin" /> : <Zap size={14} aria-hidden="true" />}
        {testing ? 'Testing…' : 'Test model'}
      </button>
    </div>
    <KeyField provider="custom" value={apiKey} onChange={onApiKey} />
    {note ? <p className="dj-provider-note" role="status">{note}</p> : null}
    <p className="dj-provider-note">
      Your browser calls this address itself; Allegra’s servers never see it or the key. Your model reads the request and Allegra
      searches the catalog. For OmniRoute, add <code>{origin}</code> under Dashboard → Security → CORS Allowed Origins.
    </p>
  </>;
}

export interface DjSettingsSheetProps {
  readonly provider: DjBrain;
  readonly model: string;
  /** A custom endpoint's URL, as typed. */
  readonly endpoint: string;
  readonly apiKey: string;
  readonly onProvider: (provider: DjBrain) => void;
  readonly onModel: (model: string) => void;
  readonly onEndpoint: (endpoint: string) => void;
  readonly onApiKey: (key: string) => void;
  readonly voice: DjVoice | null;
  readonly onClose: () => void;
  readonly ref?: Ref<HTMLDivElement>;
}

const KEY_NOTE = 'Keys are sent with each request only and are never saved by Allegra.';

/**
 * How the DJ thinks, hears and speaks. Each has a free choice that runs in the browser or on the device,
 * and a bring-your-own-key choice. Choices are remembered on this device; keys are kept in memory only.
 */
export function DjSettingsSheet({ provider, model, endpoint, apiKey, onProvider, onModel, onEndpoint, onApiKey, voice, onClose, ref }: DjSettingsSheetProps) {
  const ears = voice?.settings.ears ?? 'auto';
  const speech = voice?.settings.voice ?? 'browser';
  const cloudEars = ears === 'openai' || ears === 'groq';
  const cloudVoice = speech === 'openai' || speech === 'elevenlabs';
  const micLine = !voice ? null
    : voice.micState === 'insecure' ? 'Microphone: unavailable on this page. Browsers allow it only over https:// or on localhost.'
      : voice.micState === 'denied' ? 'Microphone: blocked. Click the icon left of the address bar → Site settings → Microphone → Allow.'
        : voice.micState === 'granted' ? 'Microphone: allowed.'
          : voice.micState === 'none' ? 'Microphone: this browser can’t record audio.'
            : 'Microphone: the browser will ask the first time you tap the mic. Choose Allow.';

  return (
    <div className="dj-settings-sheet" id="dj-settings-sheet" role="dialog" aria-label="DJ settings" ref={ref}>
      <div className="dj-provider-heading">
        <strong>Your DJ</strong>
        <button type="button" onClick={onClose} aria-label="Close DJ settings"><X size={15} /></button>
      </div>

      <section className="dj-settings-part" aria-label="How your DJ thinks">
        <h4><Brain size={14} aria-hidden="true" />Thinks with</h4>
        <div className="dj-provider-fields">
          <DjSelect<DjBrain>
            label="Provider"
            value={provider}
            onChange={onProvider}
            options={[
              { value: 'local', label: 'On this device', note: 'free · nothing to sign up for' },
              { value: 'openai', label: 'OpenAI', note: 'your key' },
              { value: 'openrouter', label: 'OpenRouter', note: 'your key · many models' },
              { value: 'gemini', label: 'Gemini', note: 'your key' },
              { value: 'custom', label: 'Custom endpoint', note: 'OmniRoute or any OpenAI-compatible URL' }
            ]}
          />
          {provider === 'custom' ? (
            <CustomEndpointFields endpoint={endpoint} model={model} apiKey={apiKey} onEndpoint={onEndpoint} onModel={onModel} onApiKey={onApiKey} />
          ) : provider !== 'local' ? <>
            <DjModelPicker key={provider} label="Model" value={model} options={DJ_THINKING_MODELS[provider]} onChange={onModel} maxLength={160} placeholder="Any tool-calling model ID" />
            <KeyField provider={provider} value={apiKey} onChange={onApiKey} />
          </> : <p className="dj-provider-note">Qwen3 0.6B runs in your browser: your first request downloads it once (about 390 MB), then it stays cached. Chrome or Edge with WebGPU is fastest. Catalog search still needs a connection.</p>}
        </div>
        {apiKey && provider !== 'local' ? <button type="button" className="dj-clear-key" onClick={() => onApiKey('')}>Forget key</button> : null}
      </section>

      {voice ? (
        <>
          <section className="dj-settings-part" aria-label="How your DJ hears you">
            <h4><Mic size={14} aria-hidden="true" />Hears you with</h4>
            <div className="dj-provider-fields">
              <DjSelect<DjEarsChoice>
                label="Speech to text"
                value={ears}
                onChange={(next) => voice.setSettings({ ears: next })}
                options={[
                  { value: 'auto', label: 'Automatic', note: 'free · the best this browser offers' },
                  ...(voice.browserEars ? [{ value: 'browser' as const, label: 'This browser’s speech', note: 'free' }] : []),
                  { value: 'local', label: 'On this device', note: `free · ${LOCAL_VOICE_MB} MB once` },
                  { value: 'openai', label: 'OpenAI', note: 'your key' },
                  { value: 'groq', label: 'Groq', note: 'your key' }
                ]}
              />
              {cloudEars ? <>
                <DjModelPicker
                  key={ears}
                  label="Model"
                  value={voice.settings.earsModel}
                  options={[]}
                  defaultLabel={`Default · ${ears === 'groq' ? 'whisper-large-v3-turbo' : 'gpt-transcribe'}`}
                  onChange={(earsModel) => voice.setSettings({ earsModel })}
                  maxLength={120}
                  placeholder="Speech-to-text model ID"
                />
                <KeyField provider={ears} value={voice.earsKey} onChange={voice.setEarsKey} />
              </> : null}
            </div>
            <p>
              {voice.engine === 'device' ? 'Recognised on this device: nothing you say leaves it.'
                : voice.engine === 'browser' ? 'Your browser recognises your voice with its own speech service. Allegra never receives the audio.'
                  : voice.engine === 'local' ? `Moonshine runs on this device, with Whisper as the fallback: the audio never leaves it. It downloads once (about ${LOCAL_VOICE_MB} MB)${voice.localReady ? ', and it’s ready' : ''}.`
                    : voice.engine === 'cloud' ? `Your request is recorded here and sent to ${ears === 'groq' ? 'Groq' : 'OpenAI'} to be written down. ${KEY_NOTE}`
                      : 'This browser can’t record audio.'}
            </p>
            {micLine ? <p className={`dj-mic-line${voice.micState === 'denied' || voice.micState === 'insecure' ? ' is-warning' : ''}`}>{micLine}</p> : null}
            <div className="dj-voice-row">
              {voice.canInstall && voice.engine === 'browser' ? (
                <button type="button" className="dj-chip-button" onClick={() => void voice.installDevice()} disabled={voice.installing}>
                  <Cpu size={14} aria-hidden="true" />{voice.installing ? 'Installing the voice pack…' : 'Recognise on this device instead'}
                </button>
              ) : null}
              <button type="button" className="dj-chip-button" aria-pressed={voice.wakeOn} onClick={() => voice.setWake(!voice.wakeOn)} disabled={!voice.wakeAvailable}>
                <Ear size={14} aria-hidden="true" />{voice.wakeOn ? '“Hey DJ” is on' : 'Turn on “Hey DJ”'}
              </button>
            </div>
            {!voice.wakeAvailable ? <p>“Hey DJ” listens all the time, so it only runs when your voice is recognised on this device.</p> : null}
          </section>

          <section className="dj-settings-part" aria-label="How your DJ speaks">
            <h4><Volume2 size={14} aria-hidden="true" />Speaks with</h4>
            <div className="dj-provider-fields">
              <DjSelect<DjVoiceChoice>
                label="Voice"
                value={speech}
                onChange={(next) => voice.setSettings({ voice: next, voiceName: '', voiceModel: '' })}
                options={[
                  { value: 'off', label: 'Silent', note: 'answers on screen only' },
                  { value: 'kokoro', label: 'Natural voice on this device', note: `free · ${LOCAL_SPEECH_MB} MB once` },
                  { value: 'browser', label: 'This browser’s voice', note: 'free' },
                  { value: 'openai', label: 'OpenAI', note: 'your key' },
                  { value: 'elevenlabs', label: 'ElevenLabs', note: 'your key' }
                ]}
              />
              {speech !== 'off' ? (
                <DjSelect<'spoken' | 'always'>
                  label="When it talks"
                  value={voice.settings.talk}
                  onChange={(talk) => voice.setSettings({ talk })}
                  options={[
                    { value: 'spoken', label: 'When I talk to it' },
                    { value: 'always', label: 'Every reply' }
                  ]}
                />
              ) : null}
              {speech === 'kokoro' ? (
                <DjSelect<string>
                  label="Voice"
                  value={voice.settings.voiceName || 'af_heart'}
                  onChange={(voiceName) => voice.setSettings({ voiceName })}
                  options={LOCAL_SPEECH_VOICES.map((option) => ({ value: option.id, label: option.label }))}
                />
              ) : null}
              {cloudVoice ? <>
                <DjModelPicker
                  key={`${speech}-voice`}
                  label={speech === 'elevenlabs' ? 'Voice ID' : 'Voice'}
                  value={voice.settings.voiceName}
                  options={speech === 'openai' ? DJ_OPENAI_VOICES : []}
                  defaultLabel={speech === 'elevenlabs' ? 'Default · George' : 'Default · Coral'}
                  onChange={(voiceName) => voice.setSettings({ voiceName })}
                  maxLength={80}
                  placeholder={speech === 'elevenlabs' ? 'Paste a voice ID' : 'Voice name'}
                />
                <DjModelPicker
                  key={`${speech}-model`}
                  label="Model"
                  value={voice.settings.voiceModel}
                  options={[]}
                  defaultLabel={`Default · ${speech === 'elevenlabs' ? 'eleven_flash_v2_5' : 'gpt-4o-mini-tts'}`}
                  onChange={(voiceModel) => voice.setSettings({ voiceModel })}
                  maxLength={120}
                  placeholder="Text-to-speech model ID"
                />
                <KeyField provider={speech} value={voice.voiceKey} onChange={voice.setVoiceKey} />
              </> : null}
            </div>
            <p>{speech === 'off' ? 'Your DJ answers in words on screen only.'
              : speech === 'kokoro' ? (voice.speechReady
                ? 'Kokoro speaks on this device: natural, free, and nothing leaves it. The music dips while it talks.'
                : `Kokoro is a natural voice that runs on this device. It downloads once (about ${LOCAL_SPEECH_MB} MB); until then the browser’s voice stands in.`)
              : speech === 'browser' ? 'Your DJ reads its answers aloud with a voice built into your device. The music dips while it talks.'
                : `Answers are spoken by ${speech === 'elevenlabs' ? 'ElevenLabs' : 'OpenAI'}. ${KEY_NOTE}`}</p>
            {speech !== 'off' ? (
              <div className="dj-voice-row">
                {speech === 'kokoro' && !voice.speechReady ? (
                  <button type="button" className="dj-chip-button dj-chip-button--accent" onClick={() => void voice.downloadSpeech()} disabled={voice.speechProgress !== null}>
                    <Cpu size={14} aria-hidden="true" />{voice.speechProgress !== null ? (voice.speechProgress >= 100 ? 'Warming up…' : `Downloading · ${voice.speechProgress}%`) : `Download · ${LOCAL_SPEECH_MB} MB`}
                  </button>
                ) : null}
                <button type="button" className="dj-chip-button" onClick={() => voice.speak('Hey! I’m your DJ. Ask me for a song, a mood, or say sing along.', { force: true })}>
                  <Volume2 size={14} aria-hidden="true" />Hear a sample
                </button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}
    </div>
  );
}
