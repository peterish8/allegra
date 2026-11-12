import { readFileSync } from 'fs';
import { join } from 'path';
import { applySavedOrder, EDIT_ENTRY, PLAYLIST_DRAG, saveDraggedOrder } from './playlistReorder';

describe('a saved order survives the reload', () => {
  const row = (id: string) => ({ id });
  // As loaded: downloaded songs first, then songs only in the account (stream ids).
  const loaded = [row('local:a'), row('local:b'), row('stream:saavn:1'), row('stream:saavn:2')];

  it('puts account-only songs back where they were dragged, not after the downloads', () => {
    const saved = ['stream:saavn:2', 'local:a', 'stream:saavn:1', 'local:b'];
    expect(applySavedOrder(loaded, saved).map(r => r.id)).toEqual(saved);
  });

  it('keeps songs added since the last drag after the ordered ones', () => {
    const saved = ['local:b', 'local:a'];
    expect(applySavedOrder(loaded, saved).map(r => r.id)).toEqual(['local:b', 'local:a', 'stream:saavn:1', 'stream:saavn:2']);
  });

  it('leaves a never-reordered playlist as loaded, and drops ids that are gone', () => {
    expect(applySavedOrder(loaded, []).map(r => r.id)).toEqual(loaded.map(r => r.id));
    expect(applySavedOrder(loaded, ['gone', 'local:b']).map(r => r.id)[0]).toBe('local:b');
  });
});

const ids = Array.from({ length: 60 }, (_, index) => `song-${index}`);

describe('saving a dragged playlist order', () => {
  it('writes exactly the dragged order, even when a song moved several screens', async () => {
    // Row 2 dragged to the end of a 60-song list: far past one screen of 64dp rows.
    const dragged = [...ids.slice(0, 2), ...ids.slice(3), ids[2]];
    const persist = jest.fn(async (_ids: readonly string[]) => undefined);
    const reload = jest.fn(async () => undefined);

    await expect(saveDraggedOrder(dragged, false, { persist, reload })).resolves.toBe('saved');
    expect(persist).toHaveBeenCalledWith(dragged);
    expect(reload).not.toHaveBeenCalled();
  });

  it('never writes a filtered subset as the playlist order', async () => {
    const persist = jest.fn(async (_ids: readonly string[]) => undefined);
    await expect(saveDraggedOrder(ids.slice(0, 3), true, { persist, reload: jest.fn() })).resolves.toBe('skipped');
    expect(persist).not.toHaveBeenCalled();
  });

  it('reloads the saved order after a failed write, and survives a failed reload', async () => {
    const reload = jest.fn(async () => undefined);
    const failing = async () => { throw new Error('SQLite busy'); };
    await expect(saveDraggedOrder(ids, false, { persist: failing, reload })).resolves.toBe('restored');
    expect(reload).toHaveBeenCalledTimes(1);

    await expect(saveDraggedOrder(ids, false, { persist: failing, reload: failing })).resolves.toBe('restored');
  });
});

describe('drag setup', () => {
  it('enters editing on the saved order with search cleared', () => {
    expect(EDIT_ENTRY).toEqual({ searchQuery: '', searchActive: false, sortOption: 'custom', sortDirection: 'asc' });
  });

  it('scrolls the list while a row is held near an edge', () => {
    expect(PLAYLIST_DRAG.autoscrollThreshold).toBeGreaterThanOrEqual(64);
    // The library's own default (100) is a slow crawl through a long playlist.
    expect(PLAYLIST_DRAG.autoscrollSpeed).toBeGreaterThan(100);
  });

  // 2026-11-11: wrapping the drag list in Animated.createAnimatedComponent handed it Reanimated's callback ref,
  // and react-native-draggable-flatlist autoscrolls only through an object ref, so no drag passed one screen.
  it('renders the drag list directly so its autoscroll gets an object ref', () => {
    const screen = readFileSync(join(__dirname, '../../screens/PlaylistDetailScreen.tsx'), 'utf8');
    expect(screen).not.toMatch(/createAnimatedComponent\(\s*DraggableFlatList/);
    expect(screen).toMatch(/<DraggableFlatList[\s\S]*?autoscrollThreshold=\{PLAYLIST_DRAG\.autoscrollThreshold\}/);
    expect(screen).toMatch(/onScrollOffsetChange=\{onDragListScroll\}/);
    expect(screen).not.toMatch(/from 'expo-haptics'/);
  });
});
