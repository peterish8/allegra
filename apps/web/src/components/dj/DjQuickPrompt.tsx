import { ArrowUpRight, LoaderCircle, Mic, Play, Send, Undo2, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import { useDjSession } from '../../hooks/useDjSession';
import { useDjVoice } from '../../hooks/useDjVoice';
import { LOCAL_VOICE_MB } from '../../lib/djWhisper';
import type { Palette } from '../../lib/palette';
import { motionTokens, reducedTransition, spring } from '../../motion';
import { DjMascot } from './DjMascot';

export interface DjQuickPromptProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly palette: Palette;
  readonly playing: boolean;
  /** True while a song is loaded on this device: a planned set then applies itself instead of waiting. */
  readonly hasSong: boolean;
  /** Opens the full DJ page. */
  readonly onOpenPage: () => void;
}

/**
 * The DJ from any page: a small glass pill above the player bar (Ctrl/⌘ J, or a tap on the mini mascot).
 * A request here is the same conversation as /dj, in mix mode, and applies to the queue without leaving
 * the page. Esc closes it and gives focus back to whatever had it.
 */
export function DjQuickPrompt({ open, onClose, palette, playing, hasSong, onOpenPage }: DjQuickPromptProps) {
  const dj = useDjSession();
  const voice = useDjVoice();
  const hearing = Boolean(voice?.listening);
  const reduced = useReducedMotion() ?? false;
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.();
    };
  }, [onClose, open]);

  const needsStart = Boolean(dj.goal === 'mix' && dj.turn && dj.turn.operation !== 'keep' && dj.turn.queue.length > 0 && !hasSong);
  const submit = (): void => {
    const value = prompt.trim();
    if (!value) return;
    // The pill always shapes the live mix, whatever the page's goal is; app requests ("play …", "like this") run at once.
    void dj.submitPrompt(value, { goal: 'mix' }).then((outcome) => {
      if (outcome.clear) setPrompt('');
    });
  };
  const transition = reduced ? reducedTransition : spring.sheet;
  const mascotEmotion = dj.working ? 'thinking' : dj.emotion === 'error' ? 'error' : dj.emotion === 'happy' ? 'happy' : 'listening';

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="dj-quick"
          className="dj-quick"
          role="dialog"
          aria-label="Ask your DJ"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.97 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
          transition={transition}
        >
          {voice?.needsLocalDownload || voice?.localProgress !== null && voice?.localProgress !== undefined || voice?.transcribing ? (
            <p className="dj-quick-reply" role="status" aria-live="polite">
              {voice.localProgress !== null ? (voice.localProgress >= 100 ? 'Almost ready, warming up my ears…' : `Getting my ears ready · ${voice.localProgress}%`)
                : voice.transcribing ? 'Writing that down…'
                  : `Here I listen on your device, so nothing you say leaves it. That needs a one-time ${LOCAL_VOICE_MB} MB download.`}
              {voice.needsLocalDownload ? <>
                <button type="button" className="dj-quick-link" onClick={() => void voice.downloadLocal()}><Mic size={12} aria-hidden="true" />Download · {LOCAL_VOICE_MB} MB</button>
                <button type="button" className="dj-quick-link" onClick={voice.dismissDownload}>Not now</button>
              </> : null}
            </p>
          ) : dj.status ? (
            <p className="dj-quick-reply" role="status" aria-live="polite">
              {dj.status}
              {dj.undoable > 0 && !dj.working ? <button type="button" className="dj-quick-link" onClick={dj.undoPlan}><Undo2 size={13} aria-hidden="true" />Undo</button> : null}
              {needsStart && dj.turn ? <button type="button" className="dj-quick-link" onClick={() => { if (dj.turn) dj.startPlan(dj.turn); }}><Play size={12} fill="currentColor" aria-hidden="true" />Start this set</button> : null}
            </p>
          ) : null}
          <form className="dj-quick-pill" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <DjMascot size="mini" emotion={mascotEmotion} palette={palette} playing={playing} />
            <input
              ref={inputRef}
              value={hearing ? voice?.transcript ?? '' : prompt}
              readOnly={hearing}
              onChange={(event) => setPrompt(event.target.value)}
              maxLength={500}
              placeholder={hearing ? 'Listening…' : 'Ask your DJ… “play Kesariya with karaoke”, “calmer”, “like this”'}
              aria-label="Ask your DJ"
            />
            {voice && voice.engine !== 'none' ? (
              <button type="button" className={`dj-quick-icon${hearing ? ' is-listening' : ''}`} onClick={() => { if (voice.listening) voice.stop(); else { voice.stopSpeaking(); voice.listen(); } }} aria-label={hearing ? 'Stop listening' : 'Speak to your DJ'} aria-pressed={hearing}>
                <Mic size={16} />
              </button>
            ) : null}
            <button type="submit" className="dj-quick-send" disabled={dj.working || !prompt.trim()} aria-label="Send to your DJ">
              {dj.working ? <LoaderCircle size={16} className="dj-spin" /> : <Send size={15} />}
            </button>
            <button type="button" className="dj-quick-icon" onClick={onOpenPage} aria-label="Open the DJ page" title="Open the DJ page"><ArrowUpRight size={16} /></button>
            <button type="button" className="dj-quick-icon" onClick={onClose} aria-label="Close"><X size={15} /></button>
          </form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
