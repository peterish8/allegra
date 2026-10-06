/**
 * Where a Blend's orbs sit, in orb widths from the centre. The hero stage and the share card both
 * place them from here, so the card shows exactly the distance the page does.
 */

/** 0 when tastes are identical, 1 when they share nothing; 0.6 while there is no match yet. */
export function orbApart(match: number | undefined): number {
  return match === undefined ? 0.6 : 1 - Math.min(99, Math.max(0, match)) / 100;
}

/** How far each orb sits from the centre. */
export function orbReach(match: number | undefined): number {
  return 0.16 + 0.5 * orbApart(match);
}

/** One member's seat: a pair side by side, a group round an ellipse starting at the top. */
export function orbSeat(index: number, seats: number, reach: number): { readonly x: number; readonly y: number } {
  if (seats === 2) return { x: index === 0 ? -reach : reach, y: 0 };
  const angle = (index / seats) * Math.PI * 2 - Math.PI / 2;
  return { x: Math.cos(angle) * reach, y: Math.sin(angle) * reach * 0.8 };
}
