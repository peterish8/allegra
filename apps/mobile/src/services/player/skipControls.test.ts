const mockPositionSV = { value: 0 };
const mockIsSeeking = { value: false };
jest.mock('../../playback/positionBus', () => ({ positionSV: mockPositionSV, isSeeking: mockIsSeeking }));

let mockNativeQueue = false;
const mockStore = {
  isPlaying: true,
  nextInPlaylist: jest.fn(async () => undefined),
  previousInPlaylist: jest.fn(),
  requestPlayback: jest.fn(),
};
const mockControls = { seekTo: jest.fn(async () => undefined), play: jest.fn() };
jest.mock('../../store/playerStore', () => ({
  usePlayerStore: { getState: () => mockStore },
  playerControls: mockControls,
  usesNativeQueue: () => mockNativeQueue,
}));

const mockOwned = {
  next: jest.fn(async () => false),
  previous: jest.fn(async () => false),
  seek: jest.fn(async (_at: number) => false),
  notifySeek: jest.fn(async (_at: number) => undefined),
};
jest.mock('../luvLink/sync', () => ({
  handleOwnedLuvLinkNext: () => mockOwned.next(),
  handleOwnedLuvLinkPrevious: () => mockOwned.previous(),
  handleOwnedLuvLinkSeek: (at: number) => mockOwned.seek(at),
  notifyOwnedLuvLinkUserSeek: (at: number) => mockOwned.notifySeek(at),
}));
const mockLegacySeek = jest.fn();
jest.mock('../luvLink/legacy/sync', () => ({ notifyLuvLinkUserSeek: (at: number) => mockLegacySeek(at) }));

import { skipBackward, skipForward } from './skipControls';

beforeEach(() => {
  jest.clearAllMocks();
  mockNativeQueue = false;
  mockPositionSV.value = 0;
  mockIsSeeking.value = false;
  mockStore.isPlaying = true;
  mockOwned.next.mockResolvedValue(false);
  mockOwned.previous.mockResolvedValue(false);
  mockOwned.seek.mockResolvedValue(false);
});

describe('skipBackward', () => {
  it('starts the song over past 3 s on the JavaScript queue, tells LuvLink, and resumes through requestPlayback', async () => {
    mockPositionSV.value = 42;
    await skipBackward();
    expect(mockControls.seekTo).toHaveBeenCalledWith(0);
    expect(mockOwned.notifySeek).toHaveBeenCalledWith(0);
    expect(mockLegacySeek).toHaveBeenCalledWith(0);
    expect(mockStore.requestPlayback).toHaveBeenCalledWith(true);
    expect(mockControls.play).not.toHaveBeenCalled();
    expect(mockStore.previousInPlaylist).not.toHaveBeenCalled();
    expect(mockIsSeeking.value).toBe(false);
  });

  it('stays paused when it was paused', async () => {
    mockPositionSV.value = 42;
    mockStore.isPlaying = false;
    await skipBackward();
    expect(mockControls.seekTo).toHaveBeenCalledWith(0);
    expect(mockStore.requestPlayback).not.toHaveBeenCalled();
  });

  it('goes back a song in the first 3 s', async () => {
    mockPositionSV.value = 2;
    await skipBackward();
    expect(mockStore.previousInPlaylist).toHaveBeenCalledTimes(1);
    expect(mockControls.seekTo).not.toHaveBeenCalled();
  });

  it('leaves the 3 s rule to the engine on Android', async () => {
    mockNativeQueue = true;
    mockPositionSV.value = 42;
    await skipBackward();
    expect(mockStore.previousInPlaylist).toHaveBeenCalledTimes(1);
    expect(mockControls.seekTo).not.toHaveBeenCalled();
  });

  it('lets a LuvLink room this phone owns take previous', async () => {
    mockOwned.previous.mockResolvedValue(true);
    mockPositionSV.value = 42;
    await skipBackward();
    expect(mockStore.previousInPlaylist).not.toHaveBeenCalled();
    expect(mockControls.seekTo).not.toHaveBeenCalled();
  });

  it('lets the room take the restart seek', async () => {
    mockOwned.seek.mockResolvedValue(true);
    mockPositionSV.value = 42;
    await skipBackward();
    expect(mockOwned.seek).toHaveBeenCalledWith(0);
    expect(mockControls.seekTo).not.toHaveBeenCalled();
  });
});

describe('skipForward', () => {
  it('moves on through the queue owner', async () => {
    await skipForward();
    expect(mockStore.nextInPlaylist).toHaveBeenCalledTimes(1);
  });

  it('lets a LuvLink room this phone owns take next', async () => {
    mockOwned.next.mockResolvedValue(true);
    await skipForward();
    expect(mockStore.nextInPlaylist).not.toHaveBeenCalled();
  });
});
