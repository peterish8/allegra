/**
 * The name of the browser a page is open in, from its user agent. Order matters: most browsers
 * also say "Chrome" and "Safari", so the specific names are tested first.
 */
export function browserNameFrom(userAgent: string): string {
  if (/Edg(?:A|iOS)?\//.test(userAgent)) return 'Edge';
  if (/OPR\/|OPT\/|Opera/.test(userAgent)) return 'Opera';
  if (/SamsungBrowser\//.test(userAgent)) return 'Samsung Internet';
  if (/Vivaldi\//.test(userAgent)) return 'Vivaldi';
  if (/DuckDuckGo\//.test(userAgent)) return 'DuckDuckGo';
  if (/Firefox\/|FxiOS\//.test(userAgent)) return 'Firefox';
  if (/Chrome\/|CriOS\//.test(userAgent)) return 'Chrome';
  if (/Safari\//.test(userAgent)) return 'Safari';
  return 'Browser';
}

interface BraveNavigator {
  readonly brave?: { readonly isBrave?: () => Promise<boolean> };
}

/** Like `browserNameFrom` for this browser, which also tells Brave apart: it reports itself as Chrome. */
export async function detectBrowserName(): Promise<string> {
  const name = browserNameFrom(navigator.userAgent);
  if (name !== 'Chrome') return name;
  try {
    if (await (navigator as BraveNavigator).brave?.isBrave?.()) return 'Brave';
  } catch { /* no answer: it is Chrome as far as anyone can tell */ }
  return name;
}
