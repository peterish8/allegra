import { motion } from 'motion/react';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { ACCOUNT_RETENTION_DAYS, GUEST_RETENTION_DAYS, MINIMUM_AGE, OPERATOR, POLICY_VERSION, operatorPublished, type LegalDocument } from '@shared/legal';

import { paths } from '../lib/routes';
import { itemVariants, pageVariants } from '../motion';

const TITLES: Record<LegalDocument, string> = {
  privacy: 'Privacy policy',
  terms: 'Terms of use',
  copyright: 'Copyright and complaints'
};

const LEADS: Record<LegalDocument, string> = {
  privacy: 'What Allegra keeps about you, why, for how long, and how to see it or have it erased.',
  terms: 'The rules for using Allegra, in plain words.',
  copyright: 'How to tell us about something that should not be here, and what we do about it.'
};

/** Effective date as people read it: "2 October 2026". */
function effectiveDate(): string {
  const [year, month, day] = POLICY_VERSION.split('-').map(Number);
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${day} ${months[(month ?? 1) - 1]} ${year}`;
}

function Block({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <motion.section className="legal-block" variants={itemVariants}>
      <h2>{title}</h2>
      {children}
    </motion.section>
  );
}

/** Who runs Allegra and who answers complaints. Says so plainly while the details are not filled in. */
function Contact() {
  if (!operatorPublished()) {
    return (
      <p className="legal-pending" role="note">
        The operator&rsquo;s name, postal address and grievance officer are not published yet. This page is a draft
        until those details are available.
      </p>
    );
  }
  return (
    <dl className="legal-contact">
      <div><dt>Allegra is run by</dt><dd>{OPERATOR.name}</dd></div>
      <div><dt>Address</dt><dd>{OPERATOR.address}</dd></div>
      <div><dt>Grievance officer</dt><dd>{OPERATOR.grievanceOfficer}</dd></div>
      <div><dt>Email</dt><dd>{OPERATOR.email}</dd></div>
    </dl>
  );
}

function Privacy() {
  return (
    <>
      <Block title="The short version">
        <p>
          Allegra is free and has no ads. It keeps what it needs to run your library and suggest music, and nothing is
          sold or shared for advertising. You can export your account data, switch off learning from your
          listening, or erase your account at any time from Settings.
        </p>
      </Block>

      <Block title="What we keep">
        <h3>If you listen without signing in</h3>
        <p>
          Your browser is given a random guest id. Under that id our servers keep the songs you like, the playlists you
          make, your last 25 listens and a taste profile (which artists and languages you play most). No name or email
          is attached to it.
        </p>
        <h3>If you sign in with Google</h3>
        <ul>
          <li>Your name and email address, as Google gives them to us. We never see your Google password.</li>
          <li>Your liked songs and playlists, including any playlist name, description and cover image you add.</li>
          <li>Your last 25 listens and your taste profile, unless you switch that off.</li>
          <li>Your language choices.</li>
          <li>The devices you use Allegra on (a name such as &ldquo;Chrome on Windows&rdquo;, the kind of device and the app version), so you can move playback between them, and what is playing while they are connected.</li>
          <li>The date you agreed to this policy and which version it was.</li>
        </ul>
        <h3>If you report a shared playlist</h3>
        <p>The reason you chose, anything you wrote, and a contact address only if you gave one.</p>
        <h3>On your own device</h3>
        <p>
          Your settings, volume, sign-in session and this device&rsquo;s name are stored in your browser. Karaoke runs
          entirely on your device: no audio is uploaded.
        </p>
      </Block>

      <Block title="Why we keep it">
        <ul>
          <li>To give you your library on every device you sign in on.</li>
          <li>To suggest music from what you play and like. This is the only profiling Allegra does.</li>
          <li>To keep the service working and to stop abuse.</li>
        </ul>
        <p>We rely on your consent, given when you sign in. You can withdraw it whenever you like (see &ldquo;Your choices&rdquo;).</p>
      </Block>

      <Block title="Who else is involved">
        <ul>
          <li><strong>Google</strong> signs you in, and serves the fonts this website uses, so your browser contacts Google&rsquo;s servers when a page loads.</li>
          <li><strong>Convex</strong> stores accounts, libraries and playback sessions.</li>
          <li><strong>Vercel</strong> hosts the website and the API. With &ldquo;Share anonymous usage data&rdquo; on in Settings, Vercel Analytics counts page views and loading speed without cookies. You can turn it off.</li>
          <li><strong>Sentry</strong> receives crash and performance reports from the Android app.</li>
          <li><strong>Music catalogues</strong> serve cover images straight to your browser, so their image servers see your internet address. Audio and lyrics are fetched by our server, not by your browser.</li>
        </ul>
        <p>These services may process data outside India. We do not sell personal data and we show no targeted advertising.</p>
      </Block>

      <Block title="How long we keep it">
        <ul>
          <li>A guest profile that has not been used for {GUEST_RETENTION_DAYS} days is erased automatically.</li>
          <li>An account that has not been used for {ACCOUNT_RETENTION_DAYS} days (two years) is erased automatically.</li>
          <li>Only your 25 most recent listens are kept; older ones are dropped as new ones arrive.</li>
          <li>A device that has been offline for 30 days is forgotten.</li>
          <li>Reports are kept for as long as it takes to deal with them and to keep a record that we did.</li>
        </ul>
      </Block>

      <Block title="Your choices">
        <ul>
          <li><strong>See it.</strong> Settings, then Manage account, then &ldquo;Download my data&rdquo; exports your account data as one file. If a large account exceeds an export limit, we tell you; contact the grievance officer for the remaining data.</li>
          <li><strong>Correct it.</strong> You can change your display name in the same place.</li>
          <li><strong>Stop the learning.</strong> &ldquo;Learn from my listening&rdquo; in Settings switches the taste profile and listening history off and erases what was learned, on every device.</li>
          <li><strong>Erase it.</strong> &ldquo;Delete my account&rdquo; removes your account and everything in it. This cannot be undone.</li>
          <li><strong>Ask us.</strong> For anything else, including naming someone to act for you, write to the grievance officer below. We answer within 90 days at the latest.</li>
        </ul>
        <p>
          If you are not satisfied with our answer, you may complain to the Data Protection Board of India.
        </p>
      </Block>

      <Block title="Children">
        <p>
          Accounts are for people aged {MINIMUM_AGE} or over. We ask you to confirm this when you sign in. If you believe
          someone under {MINIMUM_AGE} has an account, tell us and we will erase it.
        </p>
      </Block>

      <Block title="If something goes wrong">
        <p>
          If personal data is ever exposed, we will tell the people affected, in plain language, what happened, what it
          may mean for them and what we have done, and we will tell the Data Protection Board.
        </p>
      </Block>
    </>
  );
}

function Terms() {
  return (
    <>
      <Block title="What Allegra is">
        <p>
          Allegra is a free music player and its code is open source. It is offered as it is, with no guarantee that it
          will always be available or that any particular song will play. Nothing here is sold to you.
        </p>
      </Block>

      <Block title="Who can use it">
        <p>
          Anyone can listen as a guest. To sign in and keep an account you must be {MINIMUM_AGE} or older, and you
          confirm that when you sign in.
        </p>
      </Block>

      <Block title="What you add">
        <p>
          Playlist names, descriptions and cover images are yours, and you are responsible for them. By making a
          playlist public you allow Allegra to show it to anyone who has the link. Do not add anything that:
        </p>
        <ul>
          <li>belongs to someone else and you have no right to use, such as a photograph you did not take;</li>
          <li>is obscene, sexually explicit, or harmful to children;</li>
          <li>harasses, threatens or defames a person, or invades their privacy;</li>
          <li>promotes hatred or violence against people for who they are;</li>
          <li>impersonates someone or is meant to deceive;</li>
          <li>is unlawful in India, or threatens its security or public order;</li>
          <li>contains malware or tries to break the service.</li>
        </ul>
        <p>We may remove anything that breaks these rules, turn a share link off, or close an account that keeps breaking them.</p>
      </Block>

      <Block title="Music, lyrics and artwork">
        <p>
          The recordings, lyrics and cover art you find through Allegra belong to their owners. Allegra claims no rights
          in them. If you own something and want it handled differently, see{' '}
          <Link href={paths.copyright}>Copyright and complaints</Link>.
        </p>
      </Block>

      <Block title="Fair use of the service">
        <p>Do not use automated tools to bulk-download, overload or resell the service. Requests are rate limited.</p>
      </Block>

      <Block title="Our responsibility">
        <p>
          Allegra is provided free of charge and without warranty. To the extent the law allows, we are not liable for
          loss arising from using it or from it being unavailable. Nothing here limits rights you have under Indian
          consumer or data-protection law.
        </p>
      </Block>

      <Block title="Changes and law">
        <p>
          When these terms or the privacy policy change in a way that matters, the date at the top changes and you will
          be asked to agree again. These terms are governed by the laws of India.
        </p>
      </Block>
    </>
  );
}

function Copyright() {
  return (
    <>
      <Block title="Reporting a shared playlist">
        <p>
          Every shared playlist page has a <strong>Report</strong> button. Use it for a playlist name, description or
          cover image that infringes your rights or breaks the <Link href={paths.terms}>Terms of use</Link>. You do not
          need an account.
        </p>
      </Block>

      <Block title="Copyright notices">
        <p>If you own the copyright in something on Allegra, send the grievance officer a notice that includes:</p>
        <ul>
          <li>what the work is, and enough detail to identify it;</li>
          <li>proof that you own the copyright or act for the owner;</li>
          <li>where it appears on Allegra (the link, or the song or playlist name);</li>
          <li>a statement that the use is not authorised and is not permitted by law;</li>
          <li>your name, address and how to reach you.</li>
        </ul>
        <p>
          On a complete notice about something a listener uploaded or shared, we remove it or turn the link off within
          36 hours. Under the Copyright Rules 2013 that removal lasts 21 days unless a court order is sent to us in that
          time.
        </p>
      </Block>

      <Block title="How quickly we answer">
        <ul>
          <li>We acknowledge every complaint within 24 hours.</li>
          <li>For intimate imagery or impersonation complaints covered by the IT Rules, we act within 2 hours.</li>
          <li>We resolve general complaints within 7 days, and applicable content-removal requests within 36 hours.</li>
          <li>We act on applicable court or government takedown orders within 3 hours.</li>
        </ul>
      </Block>

      <Block title="Rights holders">
        <p>
          If you represent a label, publisher or artist and have a question about music that can be played through
          Allegra, write to the same address. We will answer it as a complaint under the times above.
        </p>
      </Block>
    </>
  );
}

/** One of the three policy pages. Reachable without signing in, from Settings, sign-in and shared playlists. */
export function LegalPage({ doc }: { readonly doc: LegalDocument }) {
  return (
    <motion.div className="legal-page" variants={pageVariants} initial="hidden" animate="visible">
      <motion.header className="legal-head" variants={itemVariants}>
        <h1>{TITLES[doc]}</h1>
        <p>{LEADS[doc]}</p>
        <p className="legal-date">{operatorPublished() ? "In effect from" : "Draft version"} {effectiveDate()}</p>
        <nav className="legal-nav" aria-label="Policies">
          {(Object.keys(TITLES) as LegalDocument[]).map((key) => (
            <Link key={key} href={paths[key]} aria-current={key === doc ? 'page' : undefined}>{TITLES[key]}</Link>
          ))}
        </nav>
      </motion.header>

      {doc === 'privacy' ? <Privacy /> : doc === 'terms' ? <Terms /> : <Copyright />}

      <Block title="Who to contact">
        <Contact />
      </Block>
    </motion.div>
  );
}
