import { Download, MonitorSmartphone, Heart, Mic2 } from 'lucide-react';

/** The newest phone build. CI replaces this release's file on every push to main. */
const ANDROID_APK_URL = 'https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk';
const ANDROID_RELEASES_URL = 'https://github.com/peterish8/allegra/releases/tag/apk-latest';

const PERKS = [
  { icon: MonitorSmartphone, title: 'Play anywhere', text: 'Send what is playing between your phone and this browser.' },
  { icon: Heart, title: 'Your library', text: 'Likes and playlists follow your Google account.' },
  { icon: Mic2, title: 'Lyrics in time', text: 'Synced lyrics, and songs saved to the phone to play offline.' }
] as const;

const STEPS = [
  'Open this page on your phone and tap Download.',
  'Open the file. Android may ask you to allow installs from your browser first.',
  'Open LuvLyrics and sign in with the same Google account.'
] as const;

/**
 * The Android download, shown as a small poster: the app's own icon on a phone, what it adds,
 * and the three steps to install an APK. The app installs as "LuvLyrics".
 */
export function AndroidAppCard() {
  return (
    <div className="apk-card">
      <div className="apk-card__stage" aria-hidden="true">
        <span className="apk-card__ring apk-card__ring--a" />
        <span className="apk-card__ring apk-card__ring--b" />
        <span className="apk-card__phone">
          <span className="apk-card__speaker" />
          <img className="apk-card__icon" src="/luvlyrics-app-icon.png" alt="" width={192} height={192} decoding="async" />
          <span className="apk-card__app-name">LuvLyrics</span>
        </span>
        <span className="apk-card__badge">Android</span>
      </div>

      <div className="apk-card__body">
        <p className="apk-card__eyebrow">Android phones only · APK</p>
        <h3 className="apk-card__title">Take Allegra <em>with you.</em></h3>
        <p className="apk-card__lead">
          The same music, with the same account, as an app on your Android phone. It installs as LuvLyrics. It does not run on iPhone or on this computer.
        </p>

        <ul className="apk-card__perks">
          {PERKS.map(({ icon: Icon, title, text }) => (
            <li key={title}>
              <span className="apk-card__perk-icon" aria-hidden="true"><Icon size={16} strokeWidth={1.8} /></span>
              <span><strong>{title}</strong><small>{text}</small></span>
            </li>
          ))}
        </ul>

        <div className="apk-card__actions">
          <a className="apk-card__download" href={ANDROID_APK_URL} download="LuvLyrics.apk" rel="noopener">
            <Download size={18} strokeWidth={2} aria-hidden="true" />
            <span className="apk-card__download-copy">
              <strong>Download APK</strong>
              <small>LuvLyrics.apk · about 32 MB</small>
            </span>
          </a>
          <a className="settings-link" href={ANDROID_RELEASES_URL} target="_blank" rel="noopener noreferrer">Release notes and older builds</a>
        </div>

        <ol className="apk-card__steps" aria-label="How to install">
          {STEPS.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </div>
    </div>
  );
}
