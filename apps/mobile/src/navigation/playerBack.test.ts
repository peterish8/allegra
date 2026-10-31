import { handlePlayerBack, PlayerBackActions, PlayerBackState } from './playerBack';

const state = (overrides: Partial<PlayerBackState> = {}): PlayerBackState => ({
  lyricsFullscreen: false,
  hasSheet: false,
  upNextOpen: false,
  ambient: false,
  ...overrides,
});

const actions = (): PlayerBackActions => ({
  exitLyricsFullscreen: jest.fn(),
  closeSheet: jest.fn(),
  closeUpNext: jest.fn(),
  leaveAmbient: jest.fn(),
  closePlayer: jest.fn(),
});

describe('handlePlayerBack', () => {
  it('dismisses only fullscreen lyrics before the other player surfaces', () => {
    const handlers = actions();

    handlePlayerBack(state({ lyricsFullscreen: true, hasSheet: true, upNextOpen: true, ambient: true }), handlers);

    expect(handlers.exitLyricsFullscreen).toHaveBeenCalledTimes(1);
    expect(handlers.closeSheet).not.toHaveBeenCalled();
    expect(handlers.closeUpNext).not.toHaveBeenCalled();
    expect(handlers.leaveAmbient).not.toHaveBeenCalled();
    expect(handlers.closePlayer).not.toHaveBeenCalled();
  });

  it('dismisses a sheet before Up next, ambient mode, or the player', () => {
    const handlers = actions();

    handlePlayerBack(state({ hasSheet: true, upNextOpen: true, ambient: true }), handlers);

    expect(handlers.closeSheet).toHaveBeenCalledTimes(1);
    expect(handlers.closeUpNext).not.toHaveBeenCalled();
    expect(handlers.leaveAmbient).not.toHaveBeenCalled();
    expect(handlers.closePlayer).not.toHaveBeenCalled();
  });

  it('dismisses Up next before ambient mode or the player', () => {
    const handlers = actions();

    handlePlayerBack(state({ upNextOpen: true, ambient: true }), handlers);

    expect(handlers.closeUpNext).toHaveBeenCalledTimes(1);
    expect(handlers.leaveAmbient).not.toHaveBeenCalled();
    expect(handlers.closePlayer).not.toHaveBeenCalled();
  });

  it('leaves ambient mode before closing the player', () => {
    const handlers = actions();

    handlePlayerBack(state({ ambient: true }), handlers);

    expect(handlers.leaveAmbient).toHaveBeenCalledTimes(1);
    expect(handlers.closePlayer).not.toHaveBeenCalled();
  });

  it('closes the player when no surface is open', () => {
    const handlers = actions();

    handlePlayerBack(state(), handlers);

    expect(handlers.closePlayer).toHaveBeenCalledTimes(1);
    expect(handlers.exitLyricsFullscreen).not.toHaveBeenCalled();
    expect(handlers.closeSheet).not.toHaveBeenCalled();
    expect(handlers.closeUpNext).not.toHaveBeenCalled();
    expect(handlers.leaveAmbient).not.toHaveBeenCalled();
  });
});
