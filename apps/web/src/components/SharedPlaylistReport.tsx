import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Flag, X } from 'lucide-react';
import { REPORT_CONTACT_MAX, REPORT_DETAILS_MAX, REPORT_REASONS, type ReportReason } from '@shared/legal';
import { reportSharedPlaylist } from '../lib/api';
import { lockScroll } from '../lib/scrollLock';
import { TactileButton } from './ui';

export function SharedPlaylistReport({ code }: { readonly code: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>('copyright');
  const [details, setDetails] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const unlock = lockScroll();
    (panel.current?.querySelector<HTMLSelectElement>('select') ?? panel.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busy) setOpen(false);
      if (event.key !== 'Tab') return;
      const fields = panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), select, textarea, input');
      const first = fields?.[0];
      const last = fields?.[fields.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { unlock(); window.removeEventListener('keydown', onKey); trigger.current?.focus(); };
  }, [open, busy]);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await reportSharedPlaylist(code, { reason, ...(details.trim() ? { details: details.trim() } : {}), ...(contact.trim() ? { contact: contact.trim() } : {}) });
      setSent(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not send your report. Try again.'); }
    finally { setBusy(false); }
  };
  return <>
    <button ref={trigger} type="button" className="btn-glass tactile-control" onClick={() => setOpen(true)}><Flag size={15} aria-hidden="true" /> Report</button>
    {open ? createPortal(<div className="cmdk-layer auth-layer">
      <div className="cmdk-scrim" onClick={() => { if (!busy) setOpen(false); }} />
      <div ref={panel} className="glass-sheet auth-sheet report-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button className="sheet-close" type="button" aria-label="Close report" disabled={busy} onClick={() => setOpen(false)}><X size={16} /></button>
        <div className="auth-body">
          <h2 id={titleId}>Report this playlist</h2>
          {sent ? <><p role="status" className="auth-lede">Your report was received. Thank you for letting us know.</p><TactileButton variant="secondary" onClick={() => setOpen(false)}>Done</TactileButton></> : <form className="report-form" onSubmit={(event) => void submit(event)}>
            <p className="auth-lede">Tell us about its name, description or cover. You do not need an account.</p>
            <label>Reason<select value={reason} onChange={(event) => setReason(event.target.value as ReportReason)}>{REPORT_REASONS.map((value) => <option key={value} value={value}>{({ copyright: 'Copyright', illegal: 'Illegal content', abuse: 'Abuse or impersonation', other: 'Something else' })[value]}</option>)}</select></label>
            <label>Details (optional)<textarea rows={4} maxLength={REPORT_DETAILS_MAX} value={details} onChange={(event) => setDetails(event.target.value)} /></label>
            <label>Contact (optional)<input maxLength={REPORT_CONTACT_MAX} value={contact} onChange={(event) => setContact(event.target.value)} autoComplete="email" /></label>
            {error ? <p className="auth-error" role="alert">{error}</p> : null}
            <TactileButton variant="primary" disabled={busy} type="submit">{busy ? 'Sending…' : 'Send report'}</TactileButton>
          </form>}
        </div>
      </div>
    </div>, document.body) : null}
  </>;
}
