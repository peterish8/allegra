import assert from 'node:assert/strict';
import test from 'node:test';
import { systemClock } from './clock.ts';
import { createConnectSession } from './connectSession.ts';
import { MemoryTransport } from './memoryTransport.ts';
import { FakePlayerPort } from './testing.ts';
import type { ConnectSession, DeviceRegistration, PlayerSnapshot } from './types.ts';
import type { SongSnapshot } from '../../shared/songRef.ts';

/**
 * The switch budget (2026-10-11): from the tap to sound on the other device in under a second.
 *
 * Real timers and a modelled network, so the time measured is the protocol's own: every server
 * call costs a trip up and a trip down, every state change reaches the other device a push later,
 * and the players take as long as a real one to buffer a stream or to stop. The numbers are a
 * good home connection to Convex, not a best case.
 */
const NETWORK = { upMs: 50, downMs: 50, pushMs: 50 };
/** Stream request plus metadata on the destination. */
const LOAD_MS = 350;
/** The playing device taking its time to stop (a phone's native player, a throttled tab). */
const PAUSE_MS = 150;
const BUDGET_MS = 1_000;

const song: SongSnapshot = {
  ref: 'saavn:track-1', title: 'Blue Hour', artist: 'Nila', artwork: 'https://images.example/blue-hour.jpg', duration: 212
};
const nextSong: SongSnapshot = {
  ref: 'saavn:track-2', title: 'Monsoon Window', artist: 'Ravi', artwork: 'https://images.example/monsoon.jpg', duration: 198
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A player that takes real time to load and to pause, and notes when sound starts. */
class TimedPlayer extends FakePlayerPort {
  startedAt: number | undefined;

  /** Forget the last start, so the next one measured is the switch's. */
  resetStart(): void { this.startedAt = undefined; }

  override async load(...args: Parameters<FakePlayerPort['load']>): ReturnType<FakePlayerPort['load']> {
    await sleep(LOAD_MS);
    return super.load(...args);
  }

  override async pause(): Promise<void> {
    await sleep(PAUSE_MS);
    await super.pause();
  }

  override update(patch: Partial<PlayerSnapshot>): void {
    if (patch.isPlaying && !this.getSnapshot().isPlaying) this.startedAt ??= performance.now();
    super.update(patch);
  }
}

async function until(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!condition()) {
    if (performance.now() > deadline) throw new Error('condition not met in time');
    await sleep(5);
  }
}

const device = (deviceId: string, name: string): DeviceRegistration => ({
  deviceId, name, kind: deviceId.startsWith('web') ? 'web' : 'android', appVersion: 'test', canPlay: true
});

/** The phone plays; the laptop is open beside it. Both are listening before the clock starts. */
async function phonePlaying(): Promise<{
  readonly transport: MemoryTransport; readonly laptop: TimedPlayer; readonly phone: TimedPlayer;
  readonly laptopSession: ConnectSession; readonly phoneSession: ConnectSession;
}> {
  const transport = new MemoryTransport();
  transport.seedState({
    activeDeviceId: 'phone-b', song, queue: [nextSong], isPlaying: true, positionSec: 37,
    volume: 0.8, shuffle: false, repeat: 'off', rev: 4, ownershipEpoch: 1
  });
  const phone = new TimedPlayer({ song, queue: [nextSong], isPlaying: true, positionSec: 37, volume: 0.8 });
  const laptop = new TimedPlayer();
  const phoneSession = createConnectSession({ transport, player: phone, device: device('phone-b', 'Pixel 8'), clock: systemClock });
  const laptopSession = createConnectSession({ transport, player: laptop, device: device('web-a', 'Laptop'), clock: systemClock });
  phoneSession.setVisible(true);
  laptopSession.setVisible(true);
  await until(() => laptopSession.view().ready && phoneSession.view().ready && laptopSession.view().devices.length === 2);
  // The laptop restored the phone's song paused when it opened: that is not sound.
  await until(() => laptop.getSnapshot().song !== undefined);
  laptop.resetStart();
  transport.network = NETWORK;
  return { transport, laptop, phone, laptopSession, phoneSession };
}

/** Tap on the laptop to sound there, through whichever path the phone's protocol selects. */
async function pullToLaptop(legacyPhone: boolean, cleanup: (stop: () => void) => void): Promise<number> {
  const { transport, laptop, phone, laptopSession, phoneSession } = await phonePlaying();
  cleanup(() => { laptopSession.dispose(); phoneSession.dispose(); });
  if (legacyPhone) transport.setProtocolVersion('phone-b', 1);
  const tapped = performance.now();
  const result = laptopSession.transferTo('web-a');
  await until(() => laptop.startedAt !== undefined);
  const elapsed = (laptop.startedAt ?? Number.NaN) - tapped;
  assert.deepEqual(await result, { ok: true });
  await until(() => !phone.getSnapshot().isPlaying);
  assert.equal(laptopSession.view().activeDeviceId, 'web-a');
  return elapsed;
}

test('"Play here" on the laptop takes playback from the playing phone in under a second', async (t) => {
  const elapsed = await pullToLaptop(false, (stop) => t.after(stop));
  t.diagnostic(`tap to sound: ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < BUDGET_MS, `sound started ${Math.round(elapsed)} ms after the tap (budget ${BUDGET_MS} ms)`);
});

test('a song picked on the laptop starts on the playing phone in under a second', async (t) => {
  const { phone, laptopSession, phoneSession } = await phonePlaying();
  t.after(() => { laptopSession.dispose(); phoneSession.dispose(); });
  await phone.pause();
  await until(() => laptopSession.view().isPlaying === false);
  phone.resetStart();

  const tapped = performance.now();
  laptopSession.control({ kind: 'play_song', song: nextSong, queue: [] });
  await until(() => phone.startedAt !== undefined);
  const elapsed = (phone.startedAt ?? Number.NaN) - tapped;

  t.diagnostic(`pick to sound: ${Math.round(elapsed)} ms`);
  assert.ok(elapsed < BUDGET_MS, `sound started ${Math.round(elapsed)} ms after the pick (budget ${BUDGET_MS} ms)`);
  assert.equal(phone.getSnapshot().song?.ref, nextSong.ref);
});

test('the switch no longer waits for the playing device to confirm its pause', async (t) => {
  // The same pull through the path every transfer took before 2026-10-11, kept for legacy apps:
  // a handoff the phone must see, a pause it must finish, a release it must send.
  const now = await pullToLaptop(false, (stop) => t.after(stop));
  const before = await pullToLaptop(true, (stop) => t.after(stop));
  t.diagnostic(`instant: ${Math.round(now)} ms, with the pause handshake: ${Math.round(before)} ms`);
  const saved = before - now;
  // The handshake costs a push to the phone, its pause and a release round trip.
  const handshake = NETWORK.pushMs + PAUSE_MS + NETWORK.upMs + NETWORK.downMs;
  // Half the handshake is the bar: it measures ~285 of 300 ms saved, and a loaded CI runner jitters.
  // The old code saved nothing (it took the handshake path for every online owner).
  assert.ok(saved >= handshake * 0.5, `only ${Math.round(saved)} ms faster than the handshake path (expected about ${handshake} ms)`);
});
