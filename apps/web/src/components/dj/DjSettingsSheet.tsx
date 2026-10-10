import { Brain, Cpu, Ear, ExternalLink, Mic, Volume2, X } from 'lucide-react';
import type { Ref } from 'react';

import type { DjProvider } from '@shared/dj';

import type { DjEarsChoice, DjVoice, DjVoiceChoice } from '../../hooks/useDjVoice';
import { LOCAL_SPEECH_MB, LOCAL_SPEECH_VOICES } from '../../lib/djLocalSpeech';
import { DJ_KEY_PAGES, DJ_OPENAI_VOICES, DJ_THINKING_MODELS } from '../../lib/djSession';
import { LOCAL_VOICE_MB } from '../../lib/djWhisper';
import { DjModelPicker } from './DjModelPicker';

/** A password field for one provider's key, with a link to the page that hands keys out. */
function KeyField({ provider, value, onChange }: { readonly provider: keyof typeof DJ_KEY_PAGES; readonly value: string; readonly onChange: (key: string) => void }) {
  const page = DJ_KEY_PAGES[provider];
  return (
    <label className="dj-key-field">
      <span className="dj-key-label">API key
        <a href={page.url} target="_blank" rel="noopener noreferrer" className="dj-key-link">Get one at {page.name}<ExternalLink size={11} aria-hidden="true" /></a>
      </span>
      <input type="password" autoComplete="off" value={value} onChange={(event) => onChange(event.target.value)} maxLength={512} placeholder={`Paste your ${page.name === 'Google AI Studio' ? 'Gemini' : page.name} key`} />
    </label>
  );
}

export interface DjSettingsSheetProps {
  readonly provider: DjProvider;
  readonly model: string;
  readonly apiKey: string;
  readonly onProvider: (provider: DjProvider) => void;
  readonly onModel: (model: string) => void;
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
export function DjSettingsSheet({ provider, model, apiKey, onProvider, onModel, onApiKey, voice, onClose, ref }: DjSettingsSheetProps) {
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
          <label>Provider
            <select value={provider} onChange={(event) => onProvider(event.target.value as DjProvider)}>
              <option value="local">On this device · free</option>
              <option value="openai">OpenAI · your key</option>
              <option value="openrouter">OpenRouter · your key</option>
              <option value="gemini">Gemini · your key</option>
            </select>
          </label>
          {provider !== 'local' ? <>
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
              <label>Speech to text
                <select value={ears} onChange={(event) => voice.setSettings({ ears: event.target.value as DjEarsChoice })}>
                  <option value="auto">Automatic · free</option>
                  {voice.browserEars ? <option value="browser">This browser’s speech · free</option> : null}
                  <option value="local">On this device · free</option>
                  <option value="openai">OpenAI · your key</option>
                  <option value="groq">Groq · your key</option>
                </select>
              </label>
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
              <label>Voice
                <select value={speech} onChange={(event) => voice.setSettings({ voice: event.target.value as DjVoiceChoice, voiceName: '', voiceModel: '' })}>
                  <option value="off">Silent</option>
                  <option value="kokoro">Natural voice on this device · free</option>
                  <option value="browser">This browser’s voice · free</option>
                  <option value="openai">OpenAI · your key</option>
                  <option value="elevenlabs">ElevenLabs · your key</option>
                </select>
              </label>
              {speech !== 'off' ? (
                <label>When it talks
                  <select value={voice.settings.talk} onChange={(event) => voice.setSettings({ talk: event.target.value === 'always' ? 'always' : 'spoken' })}>
                    <option value="spoken">When I talk to it</option>
                    <option value="always">Every reply</option>
                  </select>
                </label>
              ) : null}
              {speech === 'kokoro' ? (
                <label>Voice
                  <select value={voice.settings.voiceName || 'af_heart'} onChange={(event) => voice.setSettings({ voiceName: event.target.value })}>
                    {LOCAL_SPEECH_VOICES.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                </label>
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
