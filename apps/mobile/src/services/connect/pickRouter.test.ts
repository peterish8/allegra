import { fromMobileId, type SongRef, type SongSnapshot } from '@shared/songRef';
import type { ConnectDevice, ConnectSession, ConnectView, RemoteCommand } from '../../../../../packages/connect/src/index';
import type { Song } from '../../types/song';
import { createPickRouter, type PendingPick, type Pick, type PickRouterDeps } from './pickRouter';

const laptop: ConnectDevice = {
  deviceId: 'web-a', name: 'Chrome on Windows', kind: 'web', appVersion: 'web-connect-1', canPlay: true, isOnline: true, protocolVersion: 3,
};
const phone: ConnectDevice = {
  deviceId: 'phone-b', name: 'Pixel 8', kind: 'android', appVersion: '1.0.7', canPlay: true, isOnline: true, protocolVersion: 3,
};

function view(overrides: Partial<ConnectView> = {}): ConnectView {
  return {
    ready: true,
    devices: [laptop, phone],
    activeDevice: laptop,
    activeDeviceId: laptop.deviceId,
    isThisDeviceActive: false,
    activeDeviceOnline: true,
    ownershipEpoch: 2,
    queue: [],
    queueEditable: true,
    isPlaying: true,
    livePosition: 30,
    volume: 1,
    shuffle: false,
    repeat: 'off',
    queuedCommands: 0,
    autoplayBlocked: false,
    ...overrides,
  };
}

function fakeSession(initial: ConnectView) {
  let current = initial;
  const listeners = new Set<(next: ConnectView) => void>();
  const sent: RemoteCommand[] = [];
  const session: ConnectSession = {
    view: () => current,
    subscribe(listener) {
      listeners.add(listener);
      listener(current);
      return () => { listeners.delete(listener); };
    },
    livePosition: () => current.livePosition,
    control: command => { sent.push(command); },
    transferTo: async () => ({ ok: true }),
    rename: () => undefined,
    setVisible: () => undefined,
    dispose: () => undefined,
    leave: async () => undefined,
  };
  return {
    session,
    sent,
    publish(next: ConnectView) {
      current = next;
      for (const listener of [...listeners]) listener(next);
    },
  };
}

const song = (id: string, extra: Partial<Song> = {}): Song => ({
  id,
  title: `Song ${id}`,
  artist: 'Nila',
  gradientId: '0',
  duration: 200,
  dateCreated: '2026-10-04T00:00:00.000Z',
  dateModified: '2026-10-04T00:00:00.000Z',
  playCount: 0,
  lyrics: [],
  ...extra,
});

/** A streamed song (named by its id), a download with a recorded origin, and one without. */
const streamed = song('stream:saavn:aa1');
const download = song('local-b', { originId: 'saavn:bb2' });
const oldDownload = song('local-c');

const settle = async (ms = 0): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, ms));
};

function setup(initial: ConnectView, overrides: Partial<PickRouterDeps> = {}) {
  const fake = fakeSession(initial);
  const events = {
    pending: [] as (PendingPick | null)[],
    offline: [] as string[],
    onlyHere: [] as { pick: Pick; deviceName: string }[],
    leftOut: [] as number[],
    here: [] as Pick[],
  };
  const deps: PickRouterDeps = {
    connect: () => ({ session: fake.session, deviceId: phone.deviceId }),
    heldLocally: () => false,
    knownRef: item => (item.originId as SongRef | undefined) ?? fromMobileId(item.id),
    findRef: async () => null,
    snapshotFor: (item, ref): SongSnapshot => ({ ref, title: item.title, artist: item.artist ?? '', artwork: '', duration: item.duration }),
    playHere: pick => { events.here.push(pick); },
    onPending: pending => { events.pending.push(pending); },
    onOwnerOffline: name => { events.offline.push(name); },
    onOnlyHere: (pick, deviceName) => { events.onlyHere.push({ pick, deviceName }); },
    onLeftOut: count => { events.leftOut.push(count); },
    timers: {
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    readyWaitMs: 40,
    lookupTimeoutMs: 40,
    ...overrides,
  };
  const router = createPickRouter(deps);
  return { router, fake, events };
}

const pickOf = (songs: Song[], startIndex = 0): Pick => ({ playlistId: 'library', songs, startIndex });

describe('a song picked on the phone while another device plays', () => {
  it('plays on that device, with the rest of the list behind it', async () => {
    const { router, fake, events } = setup(view(), {
      findRef: async item => (item.id === oldDownload.id ? 'saavn:cc3' : null),
    });

    expect(router.route(pickOf([streamed, download, oldDownload]))).toBe(true);
    await settle();

    expect(fake.sent[0]).toEqual({
      kind: 'play_song',
      song: expect.objectContaining({ ref: 'saavn:aa1' }),
      queue: [expect.objectContaining({ ref: 'saavn:bb2' })],
    });
    // The download with no recorded origin is found, then follows the others.
    expect(fake.sent[1]).toEqual({ kind: 'queue_add', song: expect.objectContaining({ ref: 'saavn:cc3' }) });
    expect(events.here).toEqual([]);
  });

  it('is looked up first when the phone cannot name it, and shows that it is on its way', async () => {
    let answer: (ref: SongRef | null) => void = () => undefined;
    const { router, fake, events } = setup(view(), {
      findRef: () => new Promise(resolve => { answer = resolve; }),
      lookupTimeoutMs: 1_000,
    });

    expect(router.route(pickOf([oldDownload]))).toBe(true);
    await settle();
    expect(events.pending).toEqual([{ title: 'Song local-c', deviceName: 'Chrome on Windows' }]);
    expect(fake.sent).toEqual([]);

    answer('saavn:cc3');
    await settle();
    expect(events.pending.at(-1)).toBeNull();
    expect(fake.sent).toEqual([{ kind: 'play_song', song: expect.objectContaining({ ref: 'saavn:cc3' }), queue: [] }]);
    expect(events.here).toEqual([]);
  });

  it('asks before playback moves here when only this phone has it, and plays nothing meanwhile', async () => {
    const { router, fake, events } = setup(view());

    expect(router.route(pickOf([oldDownload]))).toBe(true);
    await settle(10);

    expect(events.onlyHere).toEqual([{ pick: pickOf([oldDownload]), deviceName: 'Chrome on Windows' }]);
    expect(fake.sent).toEqual([]);
    expect(events.here).toEqual([]);
  });

  it('counts the songs only this phone has instead of dropping them silently', async () => {
    const { router, fake, events } = setup(view());

    router.route(pickOf([streamed, oldDownload, song('local-d')]));
    await settle(10);

    expect(fake.sent).toHaveLength(1);
    expect(events.leftOut).toEqual([2]);
  });

  it('gives an app from before queue edits no late songs, and counts them', async () => {
    const olderLaptop = { ...laptop, protocolVersion: 2 };
    const { router, fake, events } = setup(view({ activeDevice: olderLaptop, devices: [olderLaptop, phone] }), {
      findRef: async () => 'saavn:cc3',
    });

    router.route(pickOf([streamed, oldDownload]));
    await settle();

    expect(fake.sent.map(command => command.kind)).toEqual(['play_song']);
    expect(events.leftOut).toEqual([1]);
  });

  it('goes where the newest pick says: an older one still being looked up is dropped', async () => {
    let answer: (ref: SongRef | null) => void = () => undefined;
    const { router, fake } = setup(view(), {
      findRef: () => new Promise(resolve => { answer = resolve; }),
      lookupTimeoutMs: 1_000,
    });

    router.route(pickOf([oldDownload]));
    await settle();
    router.route(pickOf([streamed]));
    await settle();
    answer('saavn:cc3');
    await settle();

    expect(fake.sent).toEqual([{ kind: 'play_song', song: expect.objectContaining({ ref: 'saavn:aa1' }), queue: [] }]);
  });
});

describe('a song picked on the phone that plays here', () => {
  it('plays at once when nothing else plays or this phone is the one playing', () => {
    const idle = setup(view({ activeDeviceId: phone.deviceId, activeDevice: phone, isThisDeviceActive: true }));
    expect(idle.router.route(pickOf([streamed]))).toBe(false);
    expect(idle.fake.sent).toEqual([]);
  });

  it('plays at once in a LuvLink room', () => {
    const room = setup(view(), { heldLocally: () => true });
    expect(room.router.route(pickOf([streamed]))).toBe(false);
    expect(room.fake.sent).toEqual([]);
  });

  it('plays at once when the playing device is offline, and says why', () => {
    const { router, fake, events } = setup(view({ activeDeviceOnline: false }));
    expect(router.route(pickOf([streamed]))).toBe(false);
    expect(fake.sent).toEqual([]);
    expect(events.offline).toEqual(['Chrome on Windows']);
  });

  it('plays at once with Connect off', () => {
    const { router } = setup(view(), { connect: () => null });
    expect(router.route(pickOf([streamed]))).toBe(false);
  });
});

describe('a pick made before Connect has heard from the server', () => {
  it('waits for it, then goes where the music really is', async () => {
    // Back from the background: the old state still says this phone plays.
    const stale = view({ ready: false, activeDeviceId: phone.deviceId, activeDevice: phone, isThisDeviceActive: true });
    const { router, fake, events } = setup(stale, { readyWaitMs: 1_000 });

    expect(router.route(pickOf([streamed]))).toBe(true);
    await settle();
    expect(fake.sent).toEqual([]);

    fake.publish(view());
    await settle();
    expect(fake.sent).toEqual([{ kind: 'play_song', song: expect.objectContaining({ ref: 'saavn:aa1' }), queue: [] }]);
    expect(events.here).toEqual([]);
  });

  it('plays here when the server stays out of reach, and does not make the next pick wait again', async () => {
    const { router, fake, events } = setup(view({ ready: false, activeDeviceId: phone.deviceId, activeDevice: phone, isThisDeviceActive: true }));

    expect(router.route(pickOf([streamed]))).toBe(true);
    await settle(20);
    expect(events.here).toEqual([pickOf([streamed])]);

    // Still out of reach a moment later: decided at once on what Connect last knew.
    expect(router.route(pickOf([download]))).toBe(false);
    expect(fake.sent).toEqual([]);
  });
});
