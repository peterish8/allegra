import { Plus } from 'lucide-react';
import Link from 'next/link';
import { useRef, useState } from 'react';

import type { BlendInviteLink } from '@shared/blendView';
import { utcDay } from '@shared/blendLimits';

import { announceBlendsChanged, useBlends } from '../../hooks/useBlends';
import { ApiError, createBlend } from '../../lib/api';
import { BLEND_TEXT } from '../../lib/blendText';
import { paths } from '../../lib/routes';
import { BlendConsentSheet } from './BlendConsentSheet';
import { BlendInviteSheet } from './BlendInviteSheet';
import { MemberDiscs } from './MemberDisc';

/** "Create a Blend": consent first, then the invite link. */
export function useCreateBlend() {
  const operationId = useRef<string | null>(null);
  const [step, setStep] = useState<'idle' | 'consent' | 'invite'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; invite: BlendInviteLink } | null>(null);

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      operationId.current ??= crypto.randomUUID();
      const blend = await createBlend(undefined, operationId.current);
      setCreated({ id: blend.id, invite: blend.invite });
      setStep('invite');
      operationId.current = null;
      announceBlendsChanged();
    } catch (failure) {
      setError(failure instanceof ApiError && failure.code === 'limit' ? BLEND_TEXT.limit : failure instanceof Error ? failure.message : 'That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const sheets = step === 'consent' ? (
    <BlendConsentSheet mode="create" busy={busy} error={error} onConfirm={() => void confirm()} onCancel={() => { setStep('idle'); setError(null); }} />
  ) : step === 'invite' && created ? (
    <BlendInviteSheet blendId={created.id} invite={created.invite} onClose={() => setStep('idle')} />
  ) : null;

  return { start: () => setStep('consent'), sheets };
}

/** The Library's Blends shelf: each Blend, and a tile to make a new one. */
export function BlendsShelf({ signedIn, onSignIn }: { readonly signedIn: boolean; readonly onSignIn: () => void }) {
  const { blends, loading, error } = useBlends(signedIn);
  const create = useCreateBlend();
  const today = utcDay(Date.now());
  return (
    <div className="blends-shelf">
      {error ? <p className="import-note" role="alert">{error}</p> : null}
      <ul className="blends-shelf__list" aria-busy={loading || undefined}>
        {blends.map((blend) => (
          <li key={blend.id}>
            <Link className="blend-tile" href={paths.blend(blend.id)}>
              <MemberDiscs members={blend.members} size="medium" />
              <span className="blend-tile__name">{blend.name}</span>
              <span className="blend-tile__meta">{blend.memberCount < 2 ? 'Waiting for a friend' : blend.builtFor === today ? 'Updated today' : 'Opens fresh today'}</span>
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className="blend-tile blend-tile--create" onClick={signedIn ? create.start : onSignIn}>
            <span className="blend-tile__plus" aria-hidden="true"><Plus size={20} /></span>
            <span className="blend-tile__name">Create a Blend</span>
            <span className="blend-tile__meta">{signedIn ? 'One playlist, both your tastes' : BLEND_TEXT.signin}</span>
          </button>
        </li>
      </ul>
      {create.sheets}
    </div>
  );
}
