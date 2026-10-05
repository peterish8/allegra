import { motion } from 'motion/react';

import { flags } from '../../lib/flags';
import { itemVariants, pageVariants } from '../../motion';
import { SpotifySyncPanel } from '../import/SpotifySyncPanel';
import { BlendsInfo } from './BlendsInfo';
import { BlendsShelf } from './BlendsShelf';

/** `/blends`: every Blend the listener is in, a way to start one, and Spotify transfer beside them. */
export function BlendsPage({ accountKey, signedIn, onSignIn }: { readonly accountKey: string | null; readonly signedIn: boolean; readonly onSignIn: () => void }) {
  return (
    <motion.section className="blends-page" aria-labelledby="blends-title" variants={pageVariants} initial="hidden" animate="visible">
      <motion.header className="import-head" variants={itemVariants}>
        <div className="blends-page__title"><h1 id="blends-title">Blends</h1><BlendsInfo /></div>
      </motion.header>
      <div className="blends-page__grid">
        <motion.div variants={itemVariants} className="blends-page__blends">
          <h2 className="blends-page__label">Your Blends</h2>
          <BlendsShelf signedIn={signedIn} onSignIn={onSignIn} />
        </motion.div>
        {flags.import ? (
          <motion.div variants={itemVariants} className="blends-page__spotify">
            <h2 className="blends-page__label">Bring your music</h2>
            {signedIn ? <SpotifySyncPanel key={accountKey ?? 'guest'} accountKey={accountKey} /> : (
              <section className="import-panel" aria-label="Spotify">
                <h2 className="import-card__title">Spotify</h2>
                <p className="import-note">Sign in to bring your Liked Songs and playlists over.</p>
                <button type="button" className="import-spotify-primary" onClick={onSignIn}>Sign in</button>
              </section>
            )}
          </motion.div>
        ) : null}
      </div>
    </motion.section>
  );
}
