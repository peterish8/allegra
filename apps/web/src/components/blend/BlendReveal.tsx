import { X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

import type { BlendDetail } from '@shared/blendView';

import { mixPalettes } from '../../lib/blendPalette';
import { BLEND_TEXT, storyText } from '../../lib/blendText';
import { DEFAULT_PALETTE, extractPalette, type Palette } from '../../lib/palette';
import { motionTokens, spring, transitionForReducedMotion } from '../../motion';
import { MusicFlowShader } from '../shader/MusicFlowShader';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { TactileButton } from '../ui';
import { MatchNumber } from './MatchNumber';
import { MemberDisc } from './MemberDisc';

/** The reveal plays once per build; storage may be unavailable, in which case it simply plays. */
export function revealKey(detail: Pick<BlendDetail, 'id' | 'builtFor' | 'buildVersion' | 'members'>): string {
  return `blend-revealed:${detail.members.find(member => member.isYou)?.userId ?? 'guest'}:${detail.id}:${detail.builtFor}:${detail.buildVersion ?? 0}`;
}

export function revealSeen(detail: Pick<BlendDetail, 'id' | 'builtFor' | 'buildVersion' | 'members'>): boolean {
  try {
    return window.localStorage.getItem(revealKey(detail)) === '1';
  } catch {
    return false;
  }
}

function markSeen(detail: Pick<BlendDetail, 'id' | 'builtFor' | 'buildVersion' | 'members'>): void {
  try {
    window.localStorage.setItem(revealKey(detail), '1');
  } catch {
    // Not remembered: the reveal plays again next visit.
  }
}

/** Each member's first own track's cover, mixed in OKLab. */
export function useBlendPalette(detail: BlendDetail): Palette | null {
  const [palette, setPalette] = useState<Palette | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const covers = detail.members.slice(0, 2).map((member) => detail.tracks.find((track) => track.for.includes(member.userId))?.song.artwork ?? '');
    void Promise.all(covers.map((src) => (src ? extractPalette(src, controller.signal).catch(() => DEFAULT_PALETTE) : Promise.resolve(DEFAULT_PALETTE))))
      .then(([a, b]) => { if (!controller.signal.aborted) setPalette(mixPalettes(a ?? DEFAULT_PALETTE, b ?? DEFAULT_PALETTE)); });
    return () => controller.abort();
  }, [detail]);
  return palette;
}

/**
 * Two discs slide in from the edges (transform only) and meet over the shader, then the match
 * counts up. Skippable at any point with Escape or the Skip button; nothing advances on its own
 * after the number lands.
 */
export function BlendReveal({ detail, onDone }: { readonly detail: BlendDetail; readonly onDone: () => void }) {
  const reduced = useReducedMotion() ?? false;
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, dialogRef);
  const palette = useBlendPalette(detail);
  const [landed, setLanded] = useState(false);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const afterRef = useRef<HTMLDivElement | null>(null);
  const finish = useRef(() => {
    markSeen(detail);
    doneRef.current();
  });
  finish.current = () => {
    markSeen(detail);
    doneRef.current();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.stopImmediatePropagation();
      finish.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const pair = detail.pairs[0];
  const match = detail.members.length > 2 && detail.pairs.length > 0
    ? Math.round(detail.pairs.reduce((total, item) => total + item.match, 0) / detail.pairs.length)
    : pair?.match ?? 0;
  const firstStory = detail.stories[0];
  const line = firstStory ? storyText(firstStory, detail).detail : undefined;
  const lowConfidence = detail.members.length <= 2 && pair?.confidence === 'low';
  const slide = (from: string) => (reduced ? { opacity: 0 } : { opacity: 0, x: from });

  return (
    <div ref={dialogRef} className="blend-reveal" role="dialog" aria-modal="true" aria-labelledby="blend-reveal-title">
      {!reduced ? <div className="blend-reveal__shader" aria-hidden="true"><MusicFlowShader energy={0.6} palette={palette} /></div> : null}
      <button type="button" className="blend-reveal__skip" onClick={() => finish.current()} aria-label="Skip the reveal"><X size={16} aria-hidden="true" /><span>Skip</span></button>
      <h2 id="blend-reveal-title" className="sr-only">{detail.name}</h2>
      <div className="blend-reveal__stage">
        <div className="blend-reveal__discs">
          {detail.members.map((member, index) => (
            // Members arrive from alternating edges and meet in the centre.
            <motion.span key={member.userId} initial={slide(index % 2 === 0 ? '-60vw' : '60vw')} animate={{ opacity: 1, x: 0 }} transition={transitionForReducedMotion(reduced, spring.hero)}>
              <MemberDisc member={member} size={detail.members.length > 2 ? 'medium' : 'large'} />
            </motion.span>
          ))}
        </div>
        <p className="blend-reveal__label">{detail.members.length > 2 ? 'Group match' : 'Taste match'}</p>
        <MatchNumber value={match} onLanded={() => { setLanded(true); window.requestAnimationFrame(() => afterRef.current?.querySelector<HTMLButtonElement>('button')?.focus()); }} />
        <motion.div
          ref={afterRef}
          inert={!landed}
          className="blend-reveal__after"
          initial={{ opacity: 0 }}
          animate={{ opacity: landed ? 1 : 0 }}
          transition={{ duration: motionTokens.duration.slow, ease: motionTokens.ease.standard }}
        >
          {lowConfidence ? <p className="blend-reveal__line">{BLEND_TEXT.lowconfidence}</p> : line ? <p className="blend-reveal__line">{line}</p> : null}
          <TactileButton variant="accent" onClick={() => finish.current()}>See your Blend</TactileButton>
        </motion.div>
      </div>
    </div>
  );
}
