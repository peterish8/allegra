export interface DeviceIdStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read the account subject from Convex Auth's JWT for local ID scoping only. */
export function accountIdFromToken(token: string | null): string | null {
  if (!token) return null;
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '='))) as { sub?: unknown };
    return typeof decoded.sub === 'string' && decoded.sub.length > 0 ? decoded.sub : null;
  } catch {
    return null;
  }
}

/** Stable across tabs for one account, but isolated from other signed-in accounts. */
export function deviceIdForAccount(
  accountId: string,
  storage: DeviceIdStorage,
  randomUUID: () => string,
  harnessId?: string | null,
): string {
  const storageKey = `allegra-device-id:${encodeURIComponent(accountId)}`;
  let base = '';
  try { base = storage.getItem(storageKey) ?? ''; } catch { /* privacy mode: use a fresh ephemeral id */ }
  if (!base) {
    base = `web-${randomUUID()}`;
    try { storage.setItem(storageKey, base); } catch { /* this tab can still connect */ }
  }
  return harnessId ? `${base}:${harnessId.slice(0, 32)}` : base;
}
