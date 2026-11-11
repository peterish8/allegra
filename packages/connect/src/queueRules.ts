/**
 * The skip and shuffle rules every platform shares.
 *
 * Twin of Android's `QueueMath.kt` (`apps/mobile/android/.../playback/QueueMath.kt`): the Kotlin engine applies
 * these to the phone's own queue, this file applies them to the phone's JavaScript queue and to the web player.
 * Keep the two in step — a rule changed here without changing QueueMath makes Android disagree with the rest.
 */

/** Past this much of a song, "previous" restarts it instead of going back (Echo's PlayerConnection). */
export const PREVIOUS_RESTART_S = 3;

export type PreviousAction = 'restart' | 'back';

/**
 * Past three seconds, or with nothing before it, "previous" starts the song over; otherwise it goes back one.
 * The same answer as `QueueMath.previousAction`.
 */
export function previousAction(positionSec: number, hasPrevious: boolean): PreviousAction {
  return positionSec > PREVIOUS_RESTART_S || !hasPrevious ? 'restart' : 'back';
}

/**
 * A play order with `currentId` first and every other id once, shuffled — the phone engine's
 * `QueueMath.shuffledOrder`. Returns [] for an empty list.
 */
export function shuffledOrder(
  ids: readonly string[],
  currentId: string | null,
  random: () => number = Math.random
): string[] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const rest = unique.filter((id) => id !== currentId);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return currentId !== null && unique.includes(currentId) ? [currentId, ...rest] : rest;
}

/**
 * The id after `currentId` in a play order. `wrap` sends the last entry back to the first (repeat all);
 * without it the end of the order has nowhere to go.
 */
export function nextInOrder(order: readonly string[], currentId: string | null, wrap: boolean): string | null {
  if (order.length === 0) return null;
  const at = currentId === null ? -1 : order.indexOf(currentId);
  if (at === -1) return order[0] ?? null;
  if (at + 1 < order.length) return order[at + 1] ?? null;
  return wrap && order.length > 1 ? order[0] ?? null : null;
}

/**
 * The id before `currentId` in a play order — the song actually heard before this one. `wrap` sends the first
 * entry back to the last (repeat all).
 */
export function previousInOrder(order: readonly string[], currentId: string | null, wrap: boolean): string | null {
  if (order.length === 0) return null;
  const at = currentId === null ? -1 : order.indexOf(currentId);
  if (at === -1) return order[order.length - 1] ?? null;
  if (at > 0) return order[at - 1] ?? null;
  return wrap && order.length > 1 ? order[order.length - 1] ?? null : null;
}

/**
 * Songs appended to the queue join the end of the play order instead of being mixed into what is already
 * lined up — `QueueMath.orderWithAppended`, so the order on screen does not rearrange under the listener.
 */
export function orderWithAppended(order: readonly string[], appended: readonly string[]): string[] {
  const seen = new Set(order);
  const next = [...order];
  for (const id of appended) {
    if (seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}
