/** "Saved in" Done, as data: the playlists to add the song to and remove it from, going from `before` to `after`. */
export interface MembershipChanges {
  add: string[];
  remove: string[];
}

export function membershipChanges(before: ReadonlySet<string>, after: ReadonlySet<string>): MembershipChanges {
  return {
    add: [...after].filter(id => !before.has(id)),
    remove: [...before].filter(id => !after.has(id)),
  };
}
