import { Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';

import { androidIntentUrl } from '@shared/shareLinks';
import { ANDROID_RELEASES_URL } from '../lib/androidRelease';

/**
 * On Android, a shared song or playlist offers "Open in LuvLyrics". A tapped link usually opens the app by itself
 * (Android App Links); this is for a link pasted into the browser, which always stays on the website. Chrome hands
 * the same link to the app when it is installed and otherwise stays here. Elsewhere nothing renders.
 */
export function OpenInApp() {
  const [href, setHref] = useState<string | null>(null);
  useEffect(() => {
    if (/Android/i.test(navigator.userAgent)) setHref(androidIntentUrl(window.location.href));
  }, []);
  if (!href) return null;
  return (
    <div className="open-in-app" role="region" aria-label="LuvLyrics for Android">
      <a className="open-in-app__primary" href={href}><Smartphone size={18} aria-hidden="true" />Open in LuvLyrics</a>
      <a className="open-in-app__secondary" href={ANDROID_RELEASES_URL} target="_blank" rel="noreferrer">Get the app</a>
    </div>
  );
}
