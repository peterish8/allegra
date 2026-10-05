import { LogIn } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import type { BlendInvitePreview } from '@shared/blendView';
import { initialsOf } from '@shared/blendLimits';

import { announceBlendsChanged } from '../../hooks/useBlends';
import { acceptBlendInvite, ApiError, previewBlendInvite } from '../../lib/api';
import { BLEND_TEXT } from '../../lib/blendText';
import { paths } from '../../lib/routes';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { motionTokens, pageVariants, spring, transitionForReducedMotion } from '../../motion';
import { TactileButton } from '../ui';
import { MemberDisc } from './MemberDisc';

type JoinState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly preview: BlendInvitePreview }
  | { readonly kind: 'notfound' | 'expired' | 'full' | 'limit' }
  | { readonly kind: 'network'; readonly message: string };

const STOP_COPY = { notfound: BLEND_TEXT.notfound, expired: BLEND_TEXT.expired, full: BLEND_TEXT.full, limit: BLEND_TEXT.limit } as const;

/**
 * `/blend/join/:code`: who invited you, then sign in, consent and join. The invite is a popup over
 * everything (the mini player and phone nav included), so Join is always reachable; the consent copy
 * sits in the same popup as the button, one step instead of a card and then a sheet.
 */
export function BlendJoinPage({ code, signedIn, onSignIn }: { readonly code: string; readonly signedIn: boolean; readonly onSignIn: () => void }) {
  const router = useRouter();
  const reduced = useReducedMotion() ?? false;
  const popup = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<JoinState>({ kind: 'loading' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: 'loading' });
    previewBlendInvite(code, controller.signal)
      .then((preview) => setState(preview.full ? { kind: 'full' } : { kind: 'ok', preview }))
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (failure instanceof ApiError && failure.status === 404) setState({ kind: 'notfound' });
        else setState({ kind: 'network', message: failure instanceof Error ? failure.message : 'That did not load.' });
      });
    return () => controller.abort();
  }, [code, attempt]);

  const join = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const blend = await acceptBlendInvite(code);
      announceBlendsChanged();
      router.push(paths.blend(blend.id));
    } catch (failure) {
      const known = failure instanceof ApiError ? failure.code : undefined;
      if (known === 'expired' || known === 'full' || known === 'limit' || known === 'notfound') {
        setState({ kind: known });
      } else {
        setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

  const inviting = state.kind === 'ok';
  useFocusTrap(inviting && signedIn, popup); // signed out, the sign-in dialog opens over this and keeps its own trap
  useEffect(() => {
    if (!inviting) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => { if (event.key === 'Escape') router.push(paths.library); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inviting, router]);

  return (
    <motion.section className="blend-join" aria-labelledby="blend-join-title" variants={pageVariants} initial="hidden" animate="visible">
      {state.kind === 'loading' ? (
        <div className="blend-join__card" aria-busy="true">
          <span className="skeleton blend-join__disc-skeleton" />
          <span className="skeleton-line skeleton-line-long" />
          <span className="skeleton-line skeleton-line-short" />
          <h1 id="blend-join-title" className="sr-only">Loading the invite</h1>
        </div>
      ) : state.kind === 'ok' ? (
        createPortal(<div className="blend-join-layer">
          <motion.div
            className="blend-sheet-backdrop"
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard }}
          />
          <motion.div
            ref={popup}
            className="blend-join__card blend-join__popup"
            role="dialog"
            aria-modal="true"
            aria-labelledby="blend-join-title"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            transition={transitionForReducedMotion(reduced, spring.sheet)}
          >
            <MemberDisc member={{ userId: state.preview.inviterName, displayName: state.preview.inviterName, initials: initialsOf(state.preview.inviterName) }} size="large" />
            <h1 id="blend-join-title">{state.preview.inviterName} wants to Blend with you</h1>
            <p>One playlist, made from both your tastes and refreshed every day.</p>
            {signedIn ? (
              <>
                <p className="blend-join__consent">{BLEND_TEXT.consentBody} <Link href={`${paths.privacy}#blends`}>How Blends use your listening</Link></p>
                <div className="blend-join__actions">
                  <TactileButton variant="accent" disabled={busy} aria-busy={busy || undefined} onClick={() => void join()}>{busy ? 'Joining…' : 'Join the Blend'}</TactileButton>
                  <TactileButton variant="ghost" onClick={() => router.push(paths.library)}>Not now</TactileButton>
                </div>
              </>
            ) : (
              <div className="blend-join__actions">
                <TactileButton variant="accent" icon={LogIn} onClick={onSignIn}>Sign in to join</TactileButton>
              </div>
            )}
            {error ? <p className="blend-sheet__error" role="alert">{error}</p> : null}
          </motion.div>
        </div>, document.body)
      ) : state.kind === 'network' ? (
        <div className="state-card" role="alert">
          <h1 id="blend-join-title" className="blend-join__stop-title">That did not load</h1>
          <p>{state.message}</p>
          <TactileButton variant="accent" onClick={() => setAttempt((count) => count + 1)}>Try again</TactileButton>
        </div>
      ) : (
        <div className="state-card">
          <h1 id="blend-join-title" className="blend-join__stop-title">{state.kind === 'full' ? 'Blend full' : state.kind === 'limit' ? 'At your limit' : state.kind === 'expired' ? 'Invite expired' : 'Blend not found'}</h1>
          <p>{STOP_COPY[state.kind]}</p>
          <Link className="import-link" href={paths.library}>Go to Library</Link>
        </div>
      )}
    </motion.section>
  );
}
