import Link from 'next/link';
import { LEGAL_PATHS, MINIMUM_AGE, POLICY_VERSION } from '@shared/legal';
import { exportAccountData } from '../lib/api';
import { LogOut } from 'lucide-react';
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { AccountProfile } from '@shared/types';

import { FloatingField } from './ui';

interface ProfileSheetProps {
  readonly profile: AccountProfile;
  readonly busy: boolean;
  readonly error: string | null;
  readonly onSaveName: (displayName: string) => Promise<void>;
  readonly onOpenPolicy: () => void;
  readonly onAgree: () => Promise<void>;
  readonly onDelete: () => Promise<void>;
  readonly onSignOut: () => Promise<void>;
}

/**
 * Signed-in account panel: frosted sheet body with avatar, display name, and email.
 * Inspired by edit-profile patterns; fields kept to what Allegra actually needs.
 */
export function ProfileSheet({ profile, busy, error, onSaveName, onSignOut, onAgree, onDelete, onOpenPolicy }: ProfileSheetProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingName, setEditingName] = useState(profile.displayName ?? '');
  const firstField = useRef<HTMLInputElement | null>(null);
  const initial = (profile.displayName ?? profile.email ?? 'A').slice(0, 1).toUpperCase();

  useEffect(() => {
    setEditingName(profile.displayName ?? '');
  }, [profile.displayName]);

  useEffect(() => {
    const timer = window.setTimeout(() => firstField.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, []);

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    await onSaveName(editingName);
  };

  const run = async (action: () => Promise<void>): Promise<void> => {
    setWorking(true);
    setActionError(null);
    try { await action(); } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : 'Could not complete that request. Try again.');
    } finally { setWorking(false); }
  };
  const download = async (): Promise<void> => {
    const data = await exportAccountData();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'allegra-my-data.json';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    if (typeof data === 'object' && data !== null && 'complete' in data && data.complete === false) {
      setActionError('Your file was downloaded, but this account exceeds an export limit. Contact the grievance officer for the remaining data.');
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const disabled = busy || working;
  const unchanged = editingName.trim() === (profile.displayName ?? '');

  return (
    <div className="profile-sheet">
      <div className="profile-sheet__hero">
        <div className="profile-sheet__avatar" aria-hidden="true">
          {initial}
        </div>
        <div className="profile-sheet__intro">
          <span className="profile-sheet__eyebrow">Your listening room</span>
          <h2>{profile.displayName ?? 'Your account'}</h2>
          {profile.email ? <p className="profile-sheet__email">{profile.email}</p> : null}
        </div>
      </div>

      <form className="profile-sheet__form" onSubmit={(event) => void save(event)}>
        <FloatingField
          ref={firstField}
          label="Display name"
          value={editingName}
          maxLength={60}
          onChange={(event) => setEditingName(event.target.value)}
        />
        <button type="submit" className="btn-primary tactile-control profile-sheet__save" disabled={disabled || unchanged}>
          Save name
        </button>
      </form>

      {error || actionError ? (
        <p className="auth-error" role="alert">
          {error ?? actionError}
        </p>
      ) : null}

      <div className="profile-privacy">
        {profile.consent?.policyVersion === POLICY_VERSION ? (
          <p className="auth-hint">Agreed to policy {profile.consent.policyVersion} on {new Date(profile.consent.at).toLocaleDateString()}.</p>
        ) : (
          <>
            <label className="consent-check"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} /><span>I am {MINIMUM_AGE} or older and agree to the <Link href={LEGAL_PATHS.terms} onClick={onOpenPolicy}>Terms</Link> and <Link href={LEGAL_PATHS.privacy} onClick={onOpenPolicy}>Privacy policy</Link>.</span></label>
            <button type="button" className="btn-glass tactile-control" disabled={disabled || !agreed} onClick={() => void run(onAgree)}>Record my agreement</button>
          </>
        )}
        <button type="button" className="btn-glass tactile-control" disabled={disabled} onClick={() => void run(download)}>Download my data</button>
        {confirmDelete ? (
          <div className="account-delete-confirm">
            <p>This permanently removes your account, likes, playlists, shared links and registered devices. It cannot be undone.</p>
            <div className="settings-confirm"><button type="button" className="btn-glass" disabled={disabled} onClick={() => setConfirmDelete(false)}>Keep my account</button><button type="button" className="btn-glass danger-action" disabled={disabled} onClick={() => void run(onDelete)}>{working ? 'Deleting…' : 'Permanently delete'}</button></div>
          </div>
        ) : <button type="button" className="profile-sheet__signout danger-action" disabled={disabled} onClick={() => setConfirmDelete(true)}>Delete my account</button>}
      </div>
      <button type="button" className="profile-sheet__signout" onClick={() => void onSignOut()} disabled={disabled}>
        <LogOut size={15} aria-hidden="true" /> Sign out
      </button>
    </div>
  );
}
