import { Check, Laptop, LoaderCircle, MonitorSmartphone, Smartphone, Volume1, Volume2, VolumeX, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CSSProperties } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from './ui';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { useNarrowViewport } from '../hooks/useNarrowViewport';
import { motionTokens } from '../motion';

export interface ConnectDeviceRow {
  readonly deviceId: string;
  readonly name: string;
  readonly kind: 'web' | 'android' | 'ios';
  readonly canPlay: boolean;
  readonly isOnline: boolean;
}

/** Everything the picker shows and does. Built once in App.tsx for the bar and the full player. */
export interface ConnectPickerState {
  readonly connected: boolean;
  readonly otherTab: boolean;
  readonly deviceId: string | null;
  readonly devices: readonly ConnectDeviceRow[];
  readonly activeDeviceId?: string;
  readonly activeDeviceName?: string;
  readonly isPlaying: boolean;
  readonly songTitle?: string;
  readonly songArtist?: string;
  readonly autoplayBlocked: boolean;
  readonly lastError?: string;
  readonly volume: number;
  readonly onTransfer: (deviceId: string) => Promise<{ readonly ok: boolean; readonly error?: string }>;
  readonly onSignIn: () => void;
  readonly onResume: () => void;
  readonly onVolume: (volume: number) => void;
}

interface ConnectPickerProps {
  readonly connect: ConnectPickerState;
  /** `player`: the full player's round tool button. `bar`: the mini player's plain icon. */
  readonly variant: 'player' | 'bar';
}

const PANEL_GAP = 12;
const PANEL_MAX_WIDTH = 340;

function DeviceGlyph({ kind, size }: { readonly kind: ConnectDeviceRow['kind']; readonly size: number }) {
  return kind === 'web' ? <Laptop size={size} aria-hidden="true" /> : <Smartphone size={size} aria-hidden="true" />;
}

/** Where the panel opens: above the trigger, right edges aligned, kept on screen. */
function anchorFor(trigger: HTMLElement): CSSProperties {
  const rect = trigger.getBoundingClientRect();
  const width = Math.min(PANEL_MAX_WIDTH, window.innerWidth - 32);
  const left = Math.min(Math.max(16, rect.right - width), window.innerWidth - width - 16);
  return { left, bottom: window.innerHeight - rect.top + PANEL_GAP, width };
}

/**
 * "Listen on": which device plays, and the volume of that device. Opens from the mini player's
 * devices button and the full player's tool row. A sheet from the bottom on narrow screens.
 */
export function ConnectPicker({ connect, variant }: ConnectPickerProps) {
  const reduced = useReducedMotion();
  const narrow = useNarrowViewport(900);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<CSSProperties>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const lastVolumeRef = useRef(connect.volume > 0 ? connect.volume : 1);
  if (connect.volume > 0) lastVolumeRef.current = connect.volume;
  useFocusTrap(open, panelRef);

  const remote = connect.otherTab || Boolean(connect.activeDeviceId && connect.activeDeviceId !== connect.deviceId);

  useLayoutEffect(() => {
    if (!open || narrow) return undefined;
    const place = (): void => { if (triggerRef.current) setAnchor(anchorFor(triggerRef.current)); };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [narrow, open]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // The full player closes on Escape too; this panel goes first.
      event.preventDefault();
      event.stopImmediatePropagation();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => { setOpen(false); }, [connect.connected]);

  const toggle = (): void => {
    setError(null);
    setOpen((value) => !value);
  };

  const choose = async (deviceId: string): Promise<void> => {
    if (busy) return;
    if (deviceId === connect.activeDeviceId) { setOpen(false); return; }
    setBusy(deviceId);
    setError(null);
    const result = await connect.onTransfer(deviceId).catch(() => ({ ok: false as const, error: undefined }));
    setBusy(null);
    if (result.ok) setOpen(false);
    else setError(result.error ?? 'Playback could not be moved. Try again in a moment.');
  };

  const local = connect.deviceId;
  const rank = (device: ConnectDeviceRow): number =>
    device.deviceId === connect.activeDeviceId ? 0 : device.deviceId === local ? 1 : device.isOnline ? 2 : 3;
  const devices = [...connect.devices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  const registered = !local || connect.devices.some((device) => device.deviceId === local);
  const active = connect.devices.find((device) => device.deviceId === connect.activeDeviceId);
  const volumePercent = Math.round(connect.volume * 100);
  const VolumeGlyph = connect.volume <= 0 ? VolumeX : connect.volume < 0.5 ? Volume1 : Volume2;
  const shownError = error ?? connect.lastError;

  const status = (device: ConnectDeviceRow): string => {
    const isLocal = device.deviceId === local;
    if (device.deviceId === connect.activeDeviceId) return `${connect.isPlaying ? 'Playing' : 'Paused'}${isLocal ? ' · this browser' : ''}`;
    if (!device.isOnline) return 'Offline';
    if (!device.canPlay) return 'In a Listen Together room';
    return isLocal ? 'This browser' : 'Ready';
  };

  const sheet = narrow
    ? { initial: reduced ? { opacity: 0 } : { opacity: 0, y: 40 }, animate: { opacity: 1, y: 0 }, exit: reduced ? { opacity: 0 } : { opacity: 0, y: 40 } }
    : { initial: reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }, animate: { opacity: 1, y: 0, scale: 1 }, exit: reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 } };

  const label = connect.connected
    ? `Listen on a device${connect.activeDeviceName ? ` · ${connect.activeDeviceName}` : ''}`
    : 'Sign in to connect devices';

  return (
    <div ref={triggerRef} className={variant === 'player' ? 'connect-control-wrap np-action--tool' : 'connect-control-wrap'}>
      {variant === 'player' ? (
        <IconButton
          icon={MonitorSmartphone}
          label={label}
          active={remote}
          className={remote ? 'connect-control--remote' : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggle}
        />
      ) : (
        <button
          type="button"
          className={`am-btn am-btn--devices${remote ? ' is-on' : ''}`}
          aria-label={label}
          title={label}
          aria-expanded={open}
          aria-haspopup="dialog"
          onClick={toggle}
        >
          <MonitorSmartphone size={17} aria-hidden="true" />
        </button>
      )}
      {typeof document === 'undefined' ? null : createPortal(
        <AnimatePresence>
          {open ? (
            <motion.section
              key="connect-picker"
              ref={panelRef}
              className={`connect-picker${narrow ? ' is-sheet' : ''}`}
              style={narrow ? undefined : anchor}
              role="dialog"
              aria-label="Listen on"
              initial={sheet.initial}
              animate={sheet.animate}
              exit={sheet.exit}
              transition={{ duration: motionTokens.duration.base, ease: motionTokens.ease.decelerate }}
            >
              <header className="connect-picker__head">
                <h2>Listen on</h2>
                <button type="button" className="connect-picker__close" onClick={() => setOpen(false)} aria-label="Close">
                  <X size={18} aria-hidden="true" />
                </button>
              </header>

              {!connect.connected ? (
                <div className="connect-picker__signin">
                  <p>Sign in with Google to play on your phone and your other browsers.</p>
                  <button type="button" className="connect-picker__primary" onClick={connect.onSignIn}>Sign in</button>
                </div>
              ) : (
                <>
                  {active ? (
                    <div className="connect-picker__now">
                      <span className={`connect-picker__now-icon${connect.isPlaying ? ' is-playing' : ''}`}>
                        <DeviceGlyph kind={active.kind} size={20} />
                      </span>
                      <span className="connect-picker__now-copy">
                        <small>{connect.isPlaying ? 'Playing on' : 'Paused on'}</small>
                        <strong>{active.deviceId === local ? 'This browser' : active.name}</strong>
                        {connect.songTitle ? <span>{connect.songTitle}{connect.songArtist ? ` · ${connect.songArtist}` : ''}</span> : null}
                      </span>
                    </div>
                  ) : (
                    <p className="connect-picker__hint">Play a song on any signed-in device and it shows up here.</p>
                  )}

                  {connect.otherTab ? <p className="connect-picker__hint" role="status">Allegra is open in another tab. Switch to it to play here.</p> : null}

                  <p className="connect-picker__label" id="connect-picker-devices">Devices</p>
                  <ul className="connect-picker__list" aria-labelledby="connect-picker-devices">
                    {!registered ? (
                      <li>
                        <button type="button" className="connect-picker__device" disabled>
                          <span className="connect-picker__device-icon"><Laptop size={18} aria-hidden="true" /></span>
                          <span className="connect-picker__device-copy"><strong>This browser</strong><small>Connecting…</small></span>
                          <LoaderCircle size={17} className="spin" aria-hidden="true" />
                        </button>
                      </li>
                    ) : null}
                    {devices.map((device) => {
                      const isActive = device.deviceId === connect.activeDeviceId;
                      const unavailable = !device.isOnline || !device.canPlay;
                      return (
                        <li key={device.deviceId}>
                          <button
                            type="button"
                            className={`connect-picker__device${isActive ? ' is-active' : ''}`}
                            disabled={!isActive && (unavailable || (busy !== null && busy !== device.deviceId))}
                            aria-current={isActive ? 'true' : undefined}
                            onClick={() => void choose(device.deviceId)}
                          >
                            <span className="connect-picker__device-icon"><DeviceGlyph kind={device.kind} size={18} /></span>
                            <span className="connect-picker__device-copy">
                              <strong>{device.name}</strong>
                              <small>{status(device)}</small>
                            </span>
                            {busy === device.deviceId
                              ? <LoaderCircle size={17} className="spin" aria-label="Moving playback" />
                              : isActive ? <Check size={18} className="connect-picker__check" aria-label="Playing here" /> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                  {devices.length <= 1 ? (
                    <p className="connect-picker__hint">Open Allegra on your phone with the same Google account to see it here.</p>
                  ) : null}

                  {active ? (
                    <div className="connect-picker__volume">
                      <button
                        type="button"
                        className="connect-picker__mute"
                        aria-label={connect.volume <= 0 ? 'Unmute' : 'Mute'}
                        onClick={() => connect.onVolume(connect.volume <= 0 ? lastVolumeRef.current : 0)}
                      >
                        <VolumeGlyph size={18} aria-hidden="true" />
                      </button>
                      <input
                        type="range"
                        className="connect-picker__range"
                        aria-label={`Volume on ${active.deviceId === local ? 'this browser' : active.name}`}
                        min={0}
                        max={1}
                        step={0.01}
                        value={connect.volume}
                        style={{ '--fill': `${volumePercent}%` } as CSSProperties}
                        onChange={(event) => connect.onVolume(Number(event.currentTarget.value))}
                      />
                      <output className="connect-picker__percent" aria-hidden="true">{volumePercent}%</output>
                    </div>
                  ) : null}

                  {connect.autoplayBlocked ? (
                    <button type="button" className="connect-picker__primary" onClick={() => { connect.onResume(); setOpen(false); }}>
                      Tap to play here
                    </button>
                  ) : null}
                </>
              )}
              {shownError ? <p className="connect-picker__error" role="status">{shownError}</p> : null}
            </motion.section>
          ) : null}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
}
