import { Copy, Share2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import type { BlendInviteLink } from '@shared/blendView';

import { announceBlendsChanged } from '../../hooks/useBlends';
import { fetchBlend } from '../../lib/api';
import { paths } from '../../lib/routes';
import { TactileButton } from '../ui';
import { BlendSheet } from './BlendSheet';

const POLL_MS = 3000;
const GIVE_UP_MS = 10 * 60 * 1000;

/** The full link to share: the API's URL, or this site's origin when the API has none configured. */
function shareUrl(invite: BlendInviteLink): string {
  if (/^https?:\/\//u.test(invite.url)) return invite.url;
  return `${window.location.origin}${paths.blendJoin(invite.code)}`;
}

/**
 * The invite link with Copy and Share. While the sheet is open and the page visible it checks the
 * Blend every 3 s (D1), and moves to the Blend once a friend has joined.
 */
export function BlendInviteSheet({ blendId, invite, onClose }: { readonly blendId: string; readonly invite: BlendInviteLink; readonly onClose: () => void }) {
  const router = useRouter();
  const url = shareUrl(invite);
  const input = useRef<HTMLInputElement | null>(null);
  const [copied, setCopied] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const started = Date.now();
    let timer: number | undefined;
    let stopped = false;
    let inFlight = false;
    const controller = new AbortController();
    const tick = async (): Promise<void> => {
      if (inFlight || stopped || document.visibilityState !== 'visible') return;
      if (Date.now() - started > GIVE_UP_MS) {
        stopped = true;
        setGaveUp(true);
        stop();
        return;
      }
      inFlight = true;
      try {
        const detail = await fetchBlend(blendId, controller.signal);
        if (!stopped && detail.members.length >= 2) {
          stopped = true;
          stop();
          announceBlendsChanged();
          onCloseRef.current();
          router.push(paths.blend(blendId));
        }
      } catch {
        // Keep waiting: a dropped poll is not a reason to give up.
      } finally {
        inFlight = false;
      }
    };
    const start = (): void => {
      if (stopped || timer !== undefined || document.visibilityState !== 'visible') return;
      timer = window.setInterval(() => { void tick(); }, POLL_MS);
    };
    const stop = (): void => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = (): void => (document.visibilityState === 'visible' ? start() : stop());
    document.addEventListener('visibilitychange', onVisibility);
    start();
    return () => {
      stopped = true;
      controller.abort();
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [blendId, router]);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      input.current?.select();
    }
  };
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  return (
    <BlendSheet title="Invite a friend" onClose={onClose}>
      {() => (
        <>
          <p className="blend-sheet__body">Send this link to a friend, or to a few (up to six of you in one Blend). It works for 7 days.</p>
          <label className="sr-only" htmlFor="blend-invite-url">Invite link</label>
          <input id="blend-invite-url" ref={input} className="blend-invite__url" readOnly value={url} onFocus={(event) => event.currentTarget.select()} />
          <div className="blend-sheet__actions">
            <TactileButton variant="accent" icon={Copy} onClick={() => void copy()}>{copied ? 'Copied' : 'Copy link'}</TactileButton>
            {canShare ? (
              <TactileButton variant="secondary" icon={Share2} onClick={() => void navigator.share({ url, title: 'Blend with me on Allegra' }).catch(() => undefined)}>Share</TactileButton>
            ) : null}
          </div>
          <p className="blend-invite__waiting" role="status">
            <span className="blend-pulse" aria-hidden="true" />
            {gaveUp ? "Still waiting. We'll show your Blend when they join." : 'Waiting for your friend…'}
          </p>
          <div className="blend-sheet__actions">
            <TactileButton variant="ghost" onClick={onClose}>Close</TactileButton>
          </div>
        </>
      )}
    </BlendSheet>
  );
}
