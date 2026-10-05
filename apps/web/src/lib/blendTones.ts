/**
 * One colour per member of a Blend. Each listener keeps the colour their id hashes to unless someone
 * who joined earlier already has it, so two people never share a colour inside one Blend.
 * All six are bright: the initials on a disc are dark ink.
 */
export const MEMBER_TONES = ['--wave', '--tone-sky', '--tone-coral', '--tone-lilac', '--tone-mint', '--tone-amber'] as const;

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

/** userId → `var(--tone-…)`, members in join order. */
export function memberTones(members: readonly { readonly userId: string }[]): ReadonlyMap<string, string> {
  const taken = new Set<number>();
  const tones = new Map<string, string>();
  for (const member of members) {
    let index = hash(member.userId) % MEMBER_TONES.length;
    while (taken.has(index) && taken.size < MEMBER_TONES.length) index = (index + 1) % MEMBER_TONES.length;
    taken.add(index);
    tones.set(member.userId, `var(${MEMBER_TONES[index]})`);
  }
  return tones;
}
