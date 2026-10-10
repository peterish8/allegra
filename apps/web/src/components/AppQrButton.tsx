'use client';

import { Download, Maximize2, Smartphone, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import Link from 'next/link';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ANDROID_APK_FALLBACK_URL, watchAndroidRelease } from '../lib/androidRelease';
import { motionTokens, reducedTransition, spring } from '../motion';

/**
 * Where the card opens. In the sidebar it becomes part of the navigation: as wide as the sidebar and
 * rising from the button row. Beside a collapsed rail it opens next to it; elsewhere under (or above)
 * the button.
 */
interface Anchor {
  readonly top?: number;
  readonly bottom?: number;
  readonly left: number;
  readonly width: number;
  readonly up: boolean;
  readonly inNav: boolean;
}
const CARD_WIDTH = 212;
/** About how tall the card is, to decide whether it fits below the button. */
const CARD_HEIGHT = 270;

/**
 * The "Get the Android app" button. On a computer it opens a small card with a QR code of the newest
 * APK, so the listener points their phone's camera at the screen and the download starts on the phone.
 * On a phone (no fine pointer) it simply goes to the download section in Settings.
 */
export function AppQrButton({ settingsHref }: { readonly settingsHref: string }) {
  const reduced = useReducedMotion() ?? false;
  const [desktop, setDesktop] = useState(false);
  const [open, setOpen] = useState(false);
  const [apkUrl, setApkUrl] = useState(ANDROID_APK_FALLBACK_URL);
  const [qr, setQr] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  /** The code shown full screen, big enough to scan from across a desk. */
  const [full, setFull] = useState(false);
  const fullRef = useRef(full);
  fullRef.current = full;
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const read = (): void => setDesktop(query.matches);
    read();
    query.addEventListener('change', read);
    return () => query.removeEventListener('change', read);
  }, []);

  // The newest build's own link once GitHub answers; the fixed link works until then.
  useEffect(() => (desktop ? watchAndroidRelease((release) => { if (release) setApkUrl(release.url); }) : undefined), [desktop]);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    void QRCode.toDataURL(apkUrl, { margin: 1, width: 360, errorCorrectionLevel: 'M', color: { dark: '#111214', light: '#ffffff' } })
      .then((url) => { if (current) setQr(url); })
      .catch(() => undefined);
    return () => { current = false; };
  }, [apkUrl, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Esc steps back one level: from full screen to the card, then from the card to the button.
      if (fullRef.current) {
        setFull(false);
        return;
      }
      setOpen(false);
      buttonRef.current?.focus();
    };
    const onPress = (event: PointerEvent): void => {
      const target = event.target as Node | null;
      if (!target || fullRef.current || cardRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPress);
    };
  }, [open]);

  if (!desktop) {
    return (
      <Link className="icon-button app-download-link" href={settingsHref} aria-label="Get the Android app" title="Get the Android app">
        <Download size={15} aria-hidden="true" />
      </Link>
    );
  }

  const toggle = (): void => {
    const box = buttonRef.current?.getBoundingClientRect();
    const header = buttonRef.current?.closest('.site-header')?.getBoundingClientRect();
    // Only a sidebar (taller than wide) hosts the card; on tablets the header is a top bar and the card drops below the button.
    const nav = header && header.height > header.width ? header : null;
    if (box && nav && nav.width >= 200) {
      setAnchor({ bottom: window.innerHeight - box.top + 10, left: nav.left + 10, width: nav.width - 20, up: true, inNav: true });
    } else if (box && nav) {
      setAnchor({ bottom: Math.max(12, window.innerHeight - box.bottom), left: nav.right + 10, width: CARD_WIDTH, up: true, inNav: false });
    } else if (box) {
      const left = Math.max(12, Math.min(window.innerWidth - CARD_WIDTH - 12, box.left));
      const up = box.bottom + 10 + CARD_HEIGHT > window.innerHeight;
      setAnchor(up ? { bottom: window.innerHeight - box.top + 10, left, width: CARD_WIDTH, up, inNav: false } : { top: box.bottom + 10, left, width: CARD_WIDTH, up, inNav: false });
    }
    setOpen((value) => !value);
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`icon-button app-download-link${open ? ' is-on' : ''}`}
        aria-label="Get the Android app: scan to download on your phone"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Get the Android app"
        onClick={toggle}
      >
        <Download size={15} aria-hidden="true" />
      </button>
      {typeof document !== 'undefined' ? createPortal(
        <AnimatePresence>
          {open && anchor ? (
            <motion.div
              ref={cardRef}
              key="app-qr"
              className={`app-qr${anchor.inNav ? ' is-in-nav' : ''}`}
              role="dialog"
              aria-label="Download the Android app"
              style={{ ...(anchor.up ? { bottom: anchor.bottom } : { top: anchor.top }), left: anchor.left, width: anchor.width, transformOrigin: anchor.up ? '20px 100%' : '20px 0' }}
              initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: anchor.up ? 6 : -6 }}
              animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -4, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
              transition={reduced ? reducedTransition : spring.sheet}
            >
              <div className="app-qr__head">
                <span className="app-qr__icon"><Smartphone size={15} aria-hidden="true" /></span>
                <strong>Get the app</strong>
                <button type="button" className="app-qr__close" aria-label="Show the code full screen" title="Full screen" onClick={() => setFull(true)}><Maximize2 size={13} /></button>
                <button type="button" className="app-qr__close" aria-label="Close" onClick={() => setOpen(false)}><X size={14} /></button>
              </div>
              <div className="app-qr__code">
                {qr ? <img src={qr} alt="QR code that downloads the LuvLyrics Android app" width={148} height={148} /> : <span className="app-qr__placeholder" aria-hidden="true" />}
                <img className="app-qr__badge" src="/luvlyrics-app-icon.png" alt="" width={30} height={30} />
              </div>
              <p>Scan with your phone’s camera.</p>
              <Link className="app-qr__more" href={settingsHref} onClick={() => setOpen(false)}>How to install it</Link>
            </motion.div>
          ) : null}
          {open && full ? (
            <motion.div
              key="app-qr-full"
              className="app-qr-full"
              role="dialog"
              aria-modal="true"
              aria-label="Scan to download the Android app"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
              transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.standard }}
              onClick={(event) => { if (event.target === event.currentTarget) setFull(false); }}
            >
              <button type="button" className="app-qr-full__close" aria-label="Back to the small code" autoFocus onClick={() => setFull(false)}><X size={18} /></button>
              <motion.div
                className="app-qr-full__code"
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.86, y: 20 }}
                animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, transition: { duration: motionTokens.duration.fast, ease: motionTokens.ease.accelerate } }}
                transition={reduced ? reducedTransition : spring.hero}
              >
                {qr ? <img src={qr} alt="QR code that downloads the LuvLyrics Android app" /> : <span className="app-qr__placeholder" aria-hidden="true" />}
                <img className="app-qr-full__badge" src="/luvlyrics-app-icon.png" alt="" width={64} height={64} />
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body
      ) : null}
    </>
  );
}
