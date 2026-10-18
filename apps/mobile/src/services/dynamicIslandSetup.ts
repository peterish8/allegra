/**
 * What Settings → Dynamic island shows, decided from the native island's status
 * (android/.../modules/DynamicIslandModule.kt). Pure, so it is tested without a phone.
 */

export interface IslandStatus {
  /** The listener turned "LuvLyrics island" on in Android's accessibility settings. */
  serviceEnabled: boolean;
  /** Android has bound the service (it follows serviceEnabled within a moment). */
  serviceRunning: boolean;
  /** The island is on screen right now (not in landscape, screen-off or the lock screen). */
  showing: boolean;
  /** The app's own switch for the island. */
  enabled: boolean;
  showWhenIdle: boolean;
  allowOnNativeIsland: boolean;
  /** The phone's own island feature ("Xiaomi's Super Island", …), or null when it has none. */
  nativeIsland: string | null;
  /** Android 13+: a sideloaded app's accessibility switch can be greyed out until "Allow restricted settings". */
  restrictedSettings: boolean;
}

export type IslandStep =
  /** The phone's system has its own island and the listener has not asked for ours. */
  | 'native'
  /** Switched off in the app. */
  | 'off'
  /** On in the app, waiting for the accessibility switch in Android's settings. */
  | 'needs-service'
  | 'ready';

export function islandSetupStep(status: IslandStatus): IslandStep {
  if (status.nativeIsland && !status.allowOnNativeIsland) return 'native';
  if (!status.enabled) return 'off';
  if (!status.serviceEnabled) return 'needs-service';
  return 'ready';
}

/** The closed section's one line. */
export function islandSummary(step: IslandStep): string {
  switch (step) {
    case 'native':
      return 'Your phone’s own island is in use';
    case 'off':
      return 'Off';
    case 'needs-service':
      return 'One switch left in Android settings';
    case 'ready':
      return 'On, round the camera over every app';
  }
}

/** Said before the listener is sent to Android's accessibility page. */
export const ISLAND_DISCLOSURE =
  'Android only lets an accessibility service draw above the status bar, so that is how the island gets there. ' +
  'It does not read or record other apps’ screens, and sends no screen data anywhere.';

export function parseIslandStatus(raw: unknown): IslandStatus | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const flag = (key: string) => r[key] === true;
  return {
    serviceEnabled: flag('serviceEnabled'),
    serviceRunning: flag('serviceRunning'),
    showing: flag('showing'),
    enabled: flag('enabled'),
    showWhenIdle: flag('showWhenIdle'),
    allowOnNativeIsland: flag('allowOnNativeIsland'),
    nativeIsland: typeof r.nativeIsland === 'string' && r.nativeIsland.length > 0 ? r.nativeIsland : null,
    restrictedSettings: flag('restrictedSettings'),
  };
}

/** What the island needs of a song's lyrics: when each line starts (ms on the player's clock) and its words. */
export interface IslandLyricsPayload {
  atMs: number[];
  texts: string[];
}

/**
 * The lines the open island shows under its controls. Only timed lyrics: plain lyrics (every line at 0)
 * have nothing to follow, so the island keeps its usual size for them. The app's lyrics delay is
 * applied here, the way the in-app lyrics use it (a line is sung once position + delay reaches it),
 * so the island and the app show the same line.
 */
export function islandLyricsPayload(
  lines: readonly { readonly timestamp: number; readonly text: string }[] | undefined,
  delaySeconds: number,
): IslandLyricsPayload | null {
  const timed = (lines ?? []).filter(line => Number.isFinite(line.timestamp) && line.text.trim().length > 0);
  if (timed.length === 0 || timed.every(line => line.timestamp === 0)) return null;
  const delay = Number.isFinite(delaySeconds) ? delaySeconds : 0;
  return {
    atMs: timed.map(line => Math.max(0, Math.round((line.timestamp - delay) * 1000))),
    texts: timed.map(line => line.text.trim()),
  };
}
