import { membershipChanges } from './savedInChanges';

describe('membershipChanges ("Saved in" Done)', () => {
  it('adds the newly ticked playlists and removes the unticked ones', () => {
    const before = new Set(['liked', 'sleep']);
    const after = new Set(['liked', 'gym', 'beats']);
    expect(membershipChanges(before, after)).toEqual({ add: ['gym', 'beats'], remove: ['sleep'] });
  });

  it('writes nothing when the listener changed nothing (or toggled one back)', () => {
    const before = new Set(['liked']);
    expect(membershipChanges(before, new Set(['liked']))).toEqual({ add: [], remove: [] });
  });

  it('can take a song out of Liked songs and leave it only in a playlist', () => {
    expect(membershipChanges(new Set(['liked']), new Set(['gym']))).toEqual({ add: ['gym'], remove: ['liked'] });
  });
});
