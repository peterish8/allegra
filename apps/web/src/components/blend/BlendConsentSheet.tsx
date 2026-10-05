import Link from 'next/link';

import { BLEND_TEXT } from '../../lib/blendText';
import { paths } from '../../lib/routes';
import { TactileButton } from '../ui';
import { BlendSheet } from './BlendSheet';

/** Asked before making or joining a Blend (PLAN.md §9 consent copy). "Not now" changes nothing. */
export function BlendConsentSheet({ mode, inviterName, busy, error, onConfirm, onCancel }: {
  readonly mode: 'create' | 'join';
  readonly inviterName?: string;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}) {
  return (
    <BlendSheet title={BLEND_TEXT.consentTitle} onClose={onCancel}>
      {() => (
        <>
          {mode === 'join' && inviterName ? <p className="blend-sheet__lead">{inviterName} wants to Blend with you.</p> : null}
          <p className="blend-sheet__body">{BLEND_TEXT.consentBody}</p>
          <p className="blend-sheet__body"><Link href={`${paths.privacy}#blends`}>How Blends use your listening</Link></p>
          <div className="blend-sheet__actions">
            <TactileButton variant="accent" disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>
              {busy ? (mode === 'create' ? 'Making it…' : 'Joining…') : mode === 'create' ? 'Make the Blend' : 'Join the Blend'}
            </TactileButton>
            <TactileButton variant="ghost" onClick={onCancel}>Not now</TactileButton>
          </div>
          {error ? <p className="blend-sheet__error" role="alert">{error}</p> : null}
        </>
      )}
    </BlendSheet>
  );
}
