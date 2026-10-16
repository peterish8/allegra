import { Guitar, Mic, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useId, useRef, type CSSProperties, type RefObject } from 'react';

import type { LiveKaraokeController } from '../hooks/useLiveKaraoke';
import { DEFAULT_KARAOKE_MIX, type KaraokeMix } from '../lib/karaokeMix';
import { motionTokens } from '../motion';

interface KaraokeMixSheetProps {
  readonly open: boolean;
  readonly karaoke: LiveKaraokeController;
  readonly onClose: () => void;
  /** The control that opened the sheet; focus goes back to it on close. */
  readonly returnFocusRef: RefObject<HTMLElement | null>;
}

const PRESETS: readonly { readonly label: string; readonly name: string; readonly mix: KaraokeMix }[] = [
  { label: 'Karaoke', name: 'Karaoke mix', mix: DEFAULT_KARAOKE_MIX },
  { label: 'Guide', name: 'Guide vocal mix', mix: { vocals: 0.25, instruments: 1 } },
  { label: 'Vocals', name: 'Vocals only', mix: { vocals: 1, instruments: 0 } },
  { label: 'Original', name: 'Original mix', mix: { vocals: 1, instruments: 1 } }
];

function sameMix(a: KaraokeMix, b: KaraokeMix): boolean {
  return Math.abs(a.vocals - b.vocals) < 0.005 && Math.abs(a.instruments - b.instruments) < 0.005;
}

/**
 * Two faders over the two stems the on-device model separates. Opened by double-tapping
 * any Karaoke button (or its sliders button). The levels are a saved preference, so they
 * can be set before karaoke starts; they only sound where there are real stems to mix.
 */
export function KaraokeMixSheet({ open, karaoke, onClose, returnFocusRef }: KaraokeMixSheetProps) {
  const reduced = useReducedMotion();
  const titleId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const returnTo = returnFocusRef.current;
    // The first fader, or the close button when the faders are locked (a disabled input can't take focus).
    const frame = window.requestAnimationFrame(() =>
      rootRef.current?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus({ preventScroll: true })
    );
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The player sheet also closes on Escape; this one goes first and alone.
      event.stopImmediatePropagation();
      onCloseRef.current();
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      // A tap on the opener is its own gesture (it may be the second half of a double tap).
      if (returnTo?.contains(target)) return;
      onCloseRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown);
      if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
    };
  }, [open, returnFocusRef]);

  const { mix, setMix, supportsMix, active, busy, backend, status } = karaoke;
  const basic = active && backend === 'midside';
  const locked = basic;

  let note: string;
  if (basic) note = 'Choose AI below; you’ll confirm before its first download.';
  else if (busy) note = 'Saved. AI mix applies as separation catches up.';
  else if (status === 'catching-up') note = 'Saved. AI mix applies once separation catches up.';
  else if (!active) note = 'Saved for next time. Turn on Karaoke to hear your mix.';
  else if (supportsMix) note = 'AI separation is running on this device.';
  else note = 'Saved for when AI separation is ready.';

  const fader = (key: keyof KaraokeMix, label: string, icon: typeof Mic) => {
    const Icon = icon;
    const percent = Math.round(mix[key] * 100);
    return (
      <label className="karaoke-mix__fader">
        <span className="karaoke-mix__label">
          <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
          <output className="karaoke-mix__value">{percent}%</output>
        </span>
        <input
          type="range"
          className="karaoke-mix__range"
          min={0}
          max={100}
          step={1}
          value={percent}
          disabled={locked}
          aria-valuetext={`${percent} percent`}
          style={{ '--level': `${percent}%` } as CSSProperties}
          onChange={(event) => setMix({ ...mix, [key]: Number(event.target.value) / 100 })}
        />
      </label>
    );
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="karaoke-mix"
          ref={rootRef}
          className="karaoke-mix"
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.98 }}
          transition={{
            duration: reduced ? motionTokens.duration.instant : motionTokens.duration.base,
            ease: motionTokens.ease.decelerate
          }}
        >
          <div className="karaoke-mix__head">
            <div className="karaoke-mix__copy">
              <span className="karaoke-mix__eyebrow">SOUND BALANCE</span>
              <h3 id={titleId}>Karaoke mix</h3>
              <p>Set vocals and music separately.</p>
            </div>
            <button type="button" className="karaoke-mix__close" onClick={onClose} aria-label="Close karaoke mix">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          <div className="karaoke-mix__levels">
            {fader('vocals', 'Vocals', Mic)}
            {fader('instruments', 'Music', Guitar)}
          </div>
          {!supportsMix ? (
            <div className="karaoke-mix__model">
              <div className="karaoke-mix__model-copy">
                <span className="karaoke-mix__model-mark" aria-hidden="true">AI</span>
                <span>
                  <strong>{busy ? 'AI model is preparing' : 'On-device AI mix'}</strong>
                  <small>{busy ? 'The model is getting ready for this song.' : 'One-time on-device model · about 750 MB'}</small>
                </span>
              </div>
              <button
                type="button"
                className="karaoke-mix__model-action"
                disabled={busy}
                aria-label="Choose the on-device AI vocal remover, about 750 megabytes"
                onClick={karaoke.chooseAiModel}
              >
                {busy ? 'Preparing' : 'Choose'}
              </button>
            </div>
          ) : null}
          <div className="karaoke-mix__preset-head">
            <span>Quick mixes</span>
            <span>Choose a starting point</span>
          </div>
          <div className="karaoke-mix__presets" role="group" aria-label="Mix presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="karaoke-mix__preset"
                aria-label={preset.name}
                aria-pressed={sameMix(mix, preset.mix)}
                disabled={locked}
                onClick={() => setMix(preset.mix)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="karaoke-mix__status" aria-live="polite">
            <span className="karaoke-mix__status-dot" aria-hidden="true" />
            <p className="karaoke-mix__note">{note}</p>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
