import { Download, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { BlendDetail } from '@shared/blendView';

import type { Palette } from '../../lib/palette';
import { TactileButton } from '../ui';
import { BlendSheet } from './BlendSheet';
import { canShareImage, matchCardBlob, shareCardFile } from './shareCard';

type Card = { readonly kind: 'drawing' } | { readonly kind: 'ready'; readonly blob: Blob; readonly url: string } | { readonly kind: 'failed' };

/**
 * The Blend's match card: drawn when the sheet opens, previewed, then shared through the system
 * sheet where the browser can share files, or downloaded. Drawing first keeps Share a fresh tap,
 * which the Web Share API requires.
 */
export function MatchCardSheet({ detail, tones, palette, match, onClose }: {
  readonly detail: BlendDetail;
  readonly tones: ReadonlyMap<string, string>;
  readonly palette: Palette;
  readonly match: number;
  readonly onClose: () => void;
}) {
  const [card, setCard] = useState<Card>({ kind: 'drawing' });
  const [note, setNote] = useState<string | null>(null);
  const [share] = useState(canShareImage);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    void matchCardBlob(detail, tones, palette, match).then((blob) => {
      if (!live) return;
      if (!blob) { setCard({ kind: 'failed' }); return; }
      url = URL.createObjectURL(blob);
      setCard({ kind: 'ready', blob, url });
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [detail, tones, palette, match]);

  const send = async (blob: Blob): Promise<void> => {
    setNote(null);
    const result = await shareCardFile(blob, 'allegra-blend-match.png', detail.name);
    if (result === 'downloaded') setNote('The card is in your downloads.');
    else if (result === 'failed') setNote('That card could not be shared. Try again.');
  };

  return (
    <BlendSheet title="Your match card" onClose={onClose}>
      {() => (
        <>
          <div className="match-card__frame" aria-busy={card.kind === 'drawing'}>
            {card.kind === 'ready' ? <img className="match-card__preview" src={card.url} alt={`${detail.name}: ${match}% ${detail.members.length > 2 ? 'group' : 'taste'} match`} width={1080} height={1920} /> : null}
            {card.kind === 'drawing' ? <span className="skeleton match-card__preview" /> : null}
          </div>
          {card.kind === 'failed' ? <p className="blend-sheet__error" role="alert">The card could not be drawn. Try again.</p> : null}
          {note ? <p className="blend-sheet__body" role="status">{note}</p> : null}
          <div className="blend-sheet__actions">
            {card.kind === 'ready' ? <TactileButton variant="accent" icon={share ? Share2 : Download} onClick={() => void send(card.blob)}>{share ? 'Share' : 'Download'}</TactileButton> : null}
            <TactileButton variant="ghost" onClick={onClose}>Close</TactileButton>
          </div>
        </>
      )}
    </BlendSheet>
  );
}
