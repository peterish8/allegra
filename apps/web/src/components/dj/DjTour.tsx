'use client';

/**
 * The DJ page's "i": twelve short scenes, acted out by the DJ itself, that explain everything on the page:
 * asking, the commands it carries out, voice and the microphone, its spoken answers, the queue, the set
 * controls, search, then step-by-step setup: free on this device (brain, then voice) or with your own
 * key or your own endpoint (OmniRoute). Built on the site's InfoTour, so it
 * opens from the "i" and folds back into it like every other page's walkthrough.
 */
import { Brain, ChevronDown, Cpu, Download, Ear, Heart, KeyRound, ListMusic, Lock, Mic, Play, Search, Server, SkipForward, Sparkles, Undo2, Volume2, Zap } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';

import { LOCAL_SPEECH_MB } from '../../lib/djLocalSpeech';
import { LOCAL_VOICE_MB } from '../../lib/djWhisper';
import type { Palette } from '../../lib/palette';
import type { TourStep } from '../InfoTour';
import { Loop, Part, Stage, useTick, type Scene } from '../infoScenes';
import { DjMascot, type DjMascotEmotion } from './DjMascot';

const TOUR_PALETTE: Palette = { primary: '#e0894a', secondary: '#9a5aa0', tertiary: '#4a72a8' };
const COVERS = [
  'linear-gradient(145deg, #ee6b5f, #783e44)', 'linear-gradient(145deg, #d9e66a, #5a6a1e)', 'linear-gradient(145deg, #7bafd4, #2f4d66)',
  'linear-gradient(145deg, #c58bd8, #4d2f66)', 'linear-gradient(145deg, #f2b66d, #7a4a1e)'
] as const;

export const DJ_TOUR: readonly TourStep[] = [
  { title: 'Meet your DJ', body: 'A companion that picks music with you. It sits at the heart of the page, nods along to the beat and takes on the colours of the song that is playing.', icon: Sparkles, pose: 'lift' },
  { title: 'Ask in your own words', body: 'Type a mood, a moment or a song in the bar under it: “late night Tamil melodies”, “something for the gym”. It lines up the next few songs and tells you why it chose each one.', icon: Sparkles, pose: 'lift' },
  { title: 'It runs the whole app', body: 'Tell it what to do: “play Kesariya”, “sing Kesariya” for karaoke, “play my Gym playlist”, “like this”, “skip”, “queue Tum Hi Ho next”, “open my library”. It happens straight away.', icon: Play, pose: 'fan' },
  { title: 'Talk instead of typing', body: 'Tap the mic and speak. The first time, your browser asks to use the microphone: choose Allow. Turn on the ear in the top corner and just say “Hey DJ, …”. Voice needs a secure https page.', icon: Mic, pose: 'orbit' },
  { title: 'It answers out loud', body: 'Replies are spoken, and the music dips while it talks. In settings, pick your browser’s voice, a natural voice that runs on your device, or your own OpenAI or ElevenLabs key. Silent turns it off.', icon: Volume2, pose: 'spread' },
  { title: 'Your queue, beside it', body: 'The song playing now sits on top in its own colours; what comes next is below, each with the reason it was picked. Tap to play, drag the grip to reorder, ✕ to remove. Undo brings back a queue the DJ replaced.', icon: ListMusic, pose: 'stack' },
  { title: 'Shape the set', body: 'Under the bar, Live DJ changes what plays next and Playlist builds one you can save. The bars set the energy, Calm to Hype. Tap Steady to plan the set’s shape (build up, wind down) and Mixed to choose familiar artists or new ones. Say “no songs by …” and that artist stays out until you tap its ✕.', icon: Sparkles, pose: 'fan' },
  { title: 'Search, then pick', body: 'The magnifier in the corner, or Ctrl K, searches everything. Pick a song and it plays at once; the DJ notices and offers more like it. Ctrl J asks the DJ from any page.', icon: Search, pose: 'lift' },
  {
    title: 'Set up: free, on this device',
    body: 'No account and no key. The DJ’s brain runs inside your browser.',
    steps: [
      'Tap the gear at the top of the stage.',
      'Under “Thinks with”, choose On this device · free.',
      'Ask for anything. Your first request downloads the model once (about 390 MB); after that it’s cached.',
      'Chrome or Edge with WebGPU is fastest. Song searches still need the internet.'
    ],
    icon: Cpu,
    pose: 'spread'
  },
  {
    title: 'Set up: voice on this device',
    body: 'Talk to it and hear it answer, with your voice never leaving the device.',
    steps: [
      `In the gear, set “Hears you with” to On this device · free (about ${LOCAL_VOICE_MB} MB, once).`,
      `Set “Speaks with” to Natural voice on this device and press Download (about ${LOCAL_SPEECH_MB} MB).`,
      'Tap the mic. When the browser asks, choose Allow.',
      'The mic needs a secure page: https:// or localhost.'
    ],
    icon: Mic,
    pose: 'orbit'
  },
  {
    title: 'Set up: your own key',
    body: 'Sharper picks from a cloud model. You pay the provider directly, and Allegra never stores the key.',
    steps: [
      'Get a key from OpenAI, Google AI Studio (Gemini) or OpenRouter. The key field links to each page.',
      'In the gear, choose that provider under “Thinks with”.',
      'Pick a model from the list. The first is tested with the DJ; Other… takes any tool-calling model.',
      'Paste the key. It lives in this tab only, so after a reload you paste it again.'
    ],
    icon: KeyRound,
    pose: 'spread'
  },
  {
    title: 'Set up: your own endpoint',
    body: 'Run a free router like OmniRoute on this computer and the DJ uses the models you connected to it.',
    steps: [
      'Start OmniRoute (omniroute serve). It answers at http://localhost:20128/v1.',
      'In its dashboard, Security → CORS Allowed Origins: add this site’s address.',
      'In the gear, choose Custom endpoint and paste the URL. Its models load by themselves.',
      'Pick one and press Test model; keep the first that answers in a few seconds.'
    ],
    icon: Server,
    pose: 'stack'
  }
];

function Mascot({ reduced, emotion, x = 0, y = 0, size = 112 }: { readonly reduced: boolean; readonly emotion: DjMascotEmotion; readonly x?: number; readonly y?: number; readonly size?: number }) {
  return (
    <Part reduced={reduced} x={x} y={y} from={{ scale: 0.6, y: 20 }} className="dj-tour__mascot" style={{ '--tour-size': `${size}px` } as CSSProperties}>
      <DjMascot size="mini" emotion={emotion} palette={TOUR_PALETTE} playing />
    </Part>
  );
}

/** The request being typed into the bar, a letter at a time. */
function Typed({ text, reduced }: { readonly text: string; readonly reduced: boolean }) {
  const tick = useTick(!reduced, 70);
  const shown = reduced ? text : text.slice(0, Math.min(text.length, tick % (text.length + 18)));
  return <span className="dj-tour__typed">{shown}<i aria-hidden="true" /></span>;
}

/** The energy dots lighting up one after another. */
function EnergyDots({ reduced }: { readonly reduced: boolean }) {
  const tick = useTick(!reduced, 520);
  const lit = reduced ? 3 : (tick % 5) + 1;
  return (
    <span className="dj-tour__dots">{[1, 2, 3, 4, 5].map((level) => <i key={level} className={level <= lit ? 'is-lit' : ''} />)}</span>
  );
}

/** Commands appear one by one around the DJ. */
function Commands({ reduced }: { readonly reduced: boolean }) {
  const [shown, setShown] = useState(reduced ? 4 : 0);
  useEffect(() => {
    if (reduced) return undefined;
    const timer = window.setInterval(() => setShown((value) => Math.min(4, value + 1)), 420);
    return () => window.clearInterval(timer);
  }, [reduced]);
  const items = [
    { x: -118, y: -46, icon: <Play size={12} fill="currentColor" />, text: 'play Kesariya' },
    { x: 118, y: -46, icon: <Mic size={12} />, text: 'sing along' },
    { x: -112, y: 50, icon: <Heart size={12} fill="currentColor" />, text: 'like this' },
    { x: 112, y: 50, icon: <SkipForward size={12} fill="currentColor" />, text: 'skip' }
  ];
  return <>{items.slice(0, shown).map((item) => (
    <Part key={item.text} reduced={reduced} x={item.x} y={item.y} from={{ x: -item.x * 0.6, y: -item.y * 0.6, scale: 0.4 }} className="dj-tour__pill">{item.icon}{item.text}</Part>
  ))}</>;
}

export const djScene: Scene = (step, reduced) => (
  <Stage step={step}>
    {step === 0 ? <>
      <Part reduced={reduced}><Loop reduced={reduced} className="info-scene__ripple dj-tour__ripple" animate={{ scale: [1, 1.8], opacity: [0.5, 0] }} duration={2} ease="easeOut" /></Part>
      <Mascot reduced={reduced} emotion="happy" size={128} />
      {[-70, 0, 70].map((x, i) => (
        <Loop key={x} reduced={reduced} className="dj-tour__note" style={{ x, y: 40, opacity: 0 }} animate={{ y: [40, -86], opacity: [0, 0.8, 0] }} duration={3} delay={i * 0.9} ease="easeOut">{i % 2 ? '♫' : '♪'}</Loop>
      ))}
    </> : step === 1 ? <>
      <Mascot reduced={reduced} emotion="listening" y={-34} size={96} />
      <Part reduced={reduced} y={62} delay={0.15} from={{ y: 30, scale: 0.9 }} className="dj-tour__bar">
        <Sparkles size={13} aria-hidden="true" /><Typed text="late night Tamil melodies" reduced={reduced} />
      </Part>
    </> : step === 2 ? <>
      <Mascot reduced={reduced} emotion="happy" size={96} />
      <Commands reduced={reduced} />
    </> : step === 3 ? <>
      <Mascot reduced={reduced} emotion="listening" x={-64} size={92} />
      <Part reduced={reduced} x={70} delay={0.1} className="dj-tour__mic">
        <Loop reduced={reduced} className="dj-tour__mic-ring" animate={{ scale: [1, 1.9], opacity: [0.6, 0] }} duration={1.6} ease="easeOut" />
        <Loop reduced={reduced} className="dj-tour__mic-ring" animate={{ scale: [1, 1.9], opacity: [0.6, 0] }} duration={1.6} delay={0.8} ease="easeOut" />
        <Mic size={24} />
      </Part>
      <Part reduced={reduced} x={70} y={-62} delay={0.3} className="dj-tour__pill"><Ear size={12} />“Hey DJ, play…”</Part>
      <Part reduced={reduced} x={70} y={64} delay={0.45} className="dj-tour__pill dj-tour__pill--quiet"><Lock size={12} />Allow microphone</Part>
    </> : step === 4 ? <>
      <Mascot reduced={reduced} emotion="happy" x={-56} size={100} />
      <Part reduced={reduced} x={70} delay={0.12} className="dj-tour__speaker">
        <Volume2 size={22} />
        <span className="dj-tour__bars">{[0, 1, 2, 3, 4].map((i) => (
          <Loop key={i} reduced={reduced} style={{ display: 'block' }} animate={{ scaleY: [0.3, 1, 0.45, 0.85, 0.3] }} duration={1.1} delay={i * 0.12}><i /></Loop>
        ))}</span>
      </Part>
    </> : step === 5 ? (
      <Part reduced={reduced} y={-6} from={{ y: 24, scale: 0.94 }} className="dj-tour__queue">
        <span className="dj-tour__row is-now" style={{ '--cover': COVERS[0] } as CSSProperties}><b /><span><strong>Kesariya</strong><small>Now playing</small></span><Heart size={11} /></span>
        {[1, 2].map((i) => (
          <Part key={i} reduced={reduced} delay={0.15 + i * 0.12} from={{ x: 30, y: 0 }} className="dj-tour__row" style={{ '--cover': COVERS[i] } as CSSProperties}>
            <em>{i}</em><b /><span><strong>{['Tum Hi Ho', 'Shayad'][i - 1]}</strong><small>Same singer, slower</small></span>
          </Part>
        ))}
        <Part reduced={reduced} delay={0.55} className="dj-tour__pill dj-tour__pill--quiet dj-tour__undo"><Undo2 size={11} />Undo</Part>
      </Part>
    ) : step === 6 ? <>
      <Part reduced={reduced} y={-48} from={{ y: 20 }} className="dj-tour__dial"><span className="dj-tour__mix">Live DJ</span><EnergyDots reduced={reduced} /></Part>
      <Part reduced={reduced} x={-62} y={14} delay={0.2} className="dj-tour__pill dj-tour__pill--quiet">Build up</Part>
      <Part reduced={reduced} x={62} y={14} delay={0.3} className="dj-tour__pill dj-tour__pill--quiet">Discover</Part>
      <Part reduced={reduced} x={-62} y={60} delay={0.42} className="dj-tour__pill dj-tour__pill--quiet">No Anirudh ✕</Part>
      <Part reduced={reduced} x={62} y={60} delay={0.5} className="dj-tour__pill">Playlist · save it</Part>
    </> : step === 7 ? <>
      <Part reduced={reduced} x={-110} className="dj-tour__search"><Search size={20} /></Part>
      <Loop reduced={reduced} className="dj-tour__flying" style={{ x: -60, background: COVERS[2] }} animate={{ x: [-70, 34], opacity: [0, 1, 1, 0], scale: [0.7, 1, 1, 0.5] }} duration={1.8} times={[0, 0.2, 0.7, 1]} />
      <Mascot reduced={reduced} emotion="happy" x={76} size={96} />
    </> : step === 9 ? <>
      {/* Voice on this device: hear, speak, then the browser's Allow. */}
      <Mascot reduced={reduced} emotion="listening" y={-50} size={84} />
      <Part reduced={reduced} x={-80} y={26} delay={0.15} className="dj-tour__pill"><Mic size={12} />Hears · on device</Part>
      <Part reduced={reduced} x={80} y={26} delay={0.28} className="dj-tour__pill"><Download size={12} />Speaks · download</Part>
      <Part reduced={reduced} y={68} delay={0.45} className="dj-tour__pill dj-tour__pill--quiet"><Lock size={12} />Allow microphone</Part>
    </> : step === 10 ? <>
      {/* Your own key: provider, then model, then the key, one after another. */}
      {[
        { y: -70, icon: <Brain size={12} />, text: 'OpenAI', chevron: true },
        { y: -28, icon: <Sparkles size={12} />, text: 'GPT-4o mini · tested', chevron: true },
        { y: 14, icon: <KeyRound size={12} />, text: '••••••••••', chevron: false }
      ].map((row, i) => (
        <Part key={row.text} reduced={reduced} y={row.y} delay={0.1 + i * 0.18} from={{ y: row.y + 24 }} className="dj-tour__pill dj-tour__field">
          {row.icon}{row.text}{row.chevron ? <ChevronDown size={12} className="dj-tour__chevron" /> : null}
        </Part>
      ))}
      <Part reduced={reduced} y={58} delay={0.66} className="dj-tour__pill dj-tour__pill--quiet"><Lock size={12} />Kept in this tab only</Part>
    </> : step === 11 ? <>
      {/* Your own endpoint: the URL, a model from its list, then a quick test. */}
      {[
        { y: -70, icon: <Server size={12} />, text: 'localhost:20128/v1', chevron: false },
        { y: -28, icon: <Sparkles size={12} />, text: 'github/gpt-4o', chevron: true },
        { y: 14, icon: <Zap size={12} />, text: 'Works · 2.0 s', chevron: false }
      ].map((row, i) => (
        <Part key={row.text} reduced={reduced} y={row.y} delay={0.1 + i * 0.18} from={{ y: row.y + 24 }} className="dj-tour__pill dj-tour__field">
          {row.icon}{row.text}{row.chevron ? <ChevronDown size={12} className="dj-tour__chevron" /> : null}
        </Part>
      ))}
      <Part reduced={reduced} y={58} delay={0.66} className="dj-tour__pill dj-tour__pill--quiet"><Lock size={12} />Your browser calls it directly</Part>
    </> : <>
      {[
        { x: -108, icon: <Brain size={16} />, title: 'Thinks', free: 'On device', key: 'OpenAI · Gemini' },
        { x: 0, icon: <Mic size={16} />, title: 'Hears', free: 'On device', key: 'OpenAI · Groq' },
        { x: 108, icon: <Volume2 size={16} />, title: 'Speaks', free: 'On device', key: 'OpenAI · ElevenLabs' }
      ].map((card, i) => (
        <Part key={card.title} reduced={reduced} x={card.x} delay={i * 0.12} from={{ y: 30 }} className="dj-tour__card">
          {card.icon}<strong>{card.title}</strong><span className="is-free">{card.free} · free</span><span><KeyRound size={10} />{card.key}</span>
        </Part>
      ))}
    </>}
  </Stage>
);
