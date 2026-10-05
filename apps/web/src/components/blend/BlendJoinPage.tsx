import { LogIn } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { BlendInvitePreview } from '@shared/blendView';
import { initialsOf } from '@shared/blendLimits';

import { announceBlendsChanged } from '../../hooks/useBlends';
import { acceptBlendInvite, ApiError, previewBlendInvite } from '../../lib/api';
import { BLEND_TEXT } from '../../lib/blendText';
import { paths } from '../../lib/routes';
import { itemVariants, pageVariants } from '../../motion';
import { TactileButton } from '../ui';
import { BlendConsentSheet } from './BlendConsentSheet';
import { MemberDisc } from './MemberDisc';

type JoinState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ok'; readonly preview: BlendInvitePreview }
  | { readonly kind: 'notfound' | 'expired' | 'full' | 'limit' }
  | { readonly kind: 'network'; readonly message: string };

const STOP_COPY = { notfound: BLEND_TEXT.notfound, expired: BLEND_TEXT.expired, full: BLEND_TEXT.full, limit: BLEND_TEXT.limit } as const;

/** `/blend/join/:code`: who invited you, then sign in, consent and join. */
export function BlendJoinPage({ code, signedIn, onSignIn }: { readonly code: string; readonly signedIn: boolean; readonly onSignIn: () => void }) {
  const router = useRouter();
  const [state, setState] = useState<JoinState>({ kind: 'loading' });
  const [consent, setConsent] = useState(false);
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
        setConsent(false);
        setState({ kind: known });
      } else {
        setError(failure instanceof Error ? failure.message : 'That did not work. Try again.');
      }
    } finally {
      setBusy(false);
    }
  };

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
        <motion.div className="blend-join__card" variants={itemVariants}>
          <MemberDisc member={{ userId: state.preview.inviterName, displayName: state.preview.inviterName, initials: initialsOf(state.preview.inviterName) }} size="large" />
          <h1 id="blend-join-title">{state.preview.inviterName} wants to Blend with you</h1>
          <p>One playlist, made from both your tastes and refreshed every day.</p>
          {signedIn ? (
            <TactileButton variant="accent" onClick={() => setConsent(true)}>Join</TactileButton>
          ) : (
            <TactileButton variant="accent" icon={LogIn} onClick={onSignIn}>Sign in to join</TactileButton>
          )}
          {error ? <p className="blend-sheet__error" role="alert">{error}</p> : null}
        </motion.div>
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
      {consent && state.kind === 'ok' ? (
        <BlendConsentSheet mode="join" inviterName={state.preview.inviterName} busy={busy} error={error} onConfirm={() => void join()} onCancel={() => { setConsent(false); setError(null); }} />
      ) : null}
    </motion.section>
  );
}
