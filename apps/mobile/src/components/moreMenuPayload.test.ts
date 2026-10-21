import { moreItemsHeight, moreItemsPayload, morePalette, moreSelectionOf, type MoreMenuEntry } from './moreMenuPayload';
import { MORE_ROWS, MORE_TILES } from './moreItems';

const tile = (key: string, icon = 'search'): MoreMenuEntry => ({ key, label: key, icon });

describe('moreMenuPayload', () => {
  it('builds the items for the real menu', () => {
    const json = moreItemsPayload(MORE_TILES, MORE_ROWS);
    expect(json).not.toBeNull();
    const items = JSON.parse(json as string) as { key: string; tile: boolean; hint: string | null }[];
    expect(items.map(i => i.key)).toEqual([...MORE_TILES, ...MORE_ROWS].map(i => i.key));
    expect(items.filter(i => i.tile)).toHaveLength(3);
    expect(items[items.length - 1].hint).toBe('Playback, lyrics, look');
    expect(items[0].hint).toBeNull();
  });

  it('falls back when the menu is not something the view can draw', () => {
    expect(moreItemsPayload([tile('a'), tile('b')], [])).toBeNull();
    expect(moreItemsPayload([tile('a'), tile('b'), tile('c')], [{ key: 'x', label: 'x', icon: 'rocket-outline' }])).toBeNull();
    expect(moreItemsPayload([tile('a'), tile('b'), tile('c', 'telescope')], [])).toBeNull();
  });

  it('hands over the theme colours it draws with', () => {
    const signal = { ink: '#111111', inkSoft: '#222222', inkMuted: '#333333', inkFaint: '#444444', wave: '#555555', bg: '#000000' };
    const palette = JSON.parse(morePalette(signal)) as Record<string, string>;
    expect(palette.wave).toBe('#555555');
    expect(palette.ink).toBe('#111111');
    expect(Object.keys(palette).sort()).toEqual(['ink', 'inkFaint', 'inkMuted', 'inkSoft', 'wave']);
  });

  it('sizes the items like the React Native layout', () => {
    expect(moreItemsHeight(0, 0.5)).toBe(78);
    expect(moreItemsHeight(1, 0.5)).toBe(144);
    expect(moreItemsHeight(2, 0.5)).toBe(202.5);
  });

  it('reads the selected key', () => {
    expect(moreSelectionOf({ nativeEvent: { key: 'Search' } })).toBe('Search');
    expect(moreSelectionOf({ nativeEvent: { key: '' } })).toBeNull();
    expect(moreSelectionOf({ nativeEvent: { key: 3 } })).toBeNull();
    expect(moreSelectionOf(undefined)).toBeNull();
  });
});
