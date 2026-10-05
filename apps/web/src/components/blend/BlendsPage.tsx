import { motion } from 'motion/react';

import { itemVariants, pageVariants } from '../../motion';
import { BlendsShelf } from './BlendsShelf';

/** `/blends`: every Blend the listener is in, and a way to start one. */
export function BlendsPage({ signedIn, onSignIn }: { readonly signedIn: boolean; readonly onSignIn: () => void }) {
  return (
    <motion.section className="blends-page" aria-labelledby="blends-title" variants={pageVariants} initial="hidden" animate="visible">
      <motion.header className="import-head" variants={itemVariants}>
        <h1 id="blends-title">Blends</h1>
        <p>One playlist made from your taste and a friend&rsquo;s, refreshed every day.</p>
      </motion.header>
      <motion.div variants={itemVariants}><BlendsShelf signedIn={signedIn} onSignIn={onSignIn} /></motion.div>
    </motion.section>
  );
}
