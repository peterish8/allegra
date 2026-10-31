import {
  consumePlayerHardwareBack,
  handlePlayerBack,
  PlayerBackActions,
  PlayerBackState,
  registerPlayerBackHandler,
} from './playerBack';

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

describe('consumePlayerHardwareBack', () => {
  it('lets the navigator handle Back when no player screen is focused', () => {
    expect(consumePlayerHardwareBack()).toBe(false);
  });

  it('consumes Back and invokes the focused player handler', () => {
    const handler = jest.fn();
    const unregister = registerPlayerBackHandler(handler);

    expect(consumePlayerHardwareBack()).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);

    unregister();
    expect(consumePlayerHardwareBack()).toBe(false);
  });

  it('does not let an older blurred screen clear the current handler', () => {
    const olderHandler = jest.fn();
    const currentHandler = jest.fn();
    const unregisterOlder = registerPlayerBackHandler(olderHandler);
    const unregisterCurrent = registerPlayerBackHandler(currentHandler);

    unregisterOlder();

    expect(consumePlayerHardwareBack()).toBe(true);
    expect(olderHandler).not.toHaveBeenCalled();
    expect(currentHandler).toHaveBeenCalledTimes(1);

    unregisterCurrent();
  });
});
