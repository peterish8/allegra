import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Spent OAuth codes and refresh tokens are only worth remembering until they expire.
crons.interval('sweep expired oauth grants', { hours: 24 }, internal.oauth.sweep, {});
// Keep the Connect command queue short-lived and prune long-inactive device registrations.
crons.interval('sweep Connect commands and stale devices', { minutes: 5 }, internal.connect.sweep, {});
// The privacy policy's retention periods (packages/shared/legal.ts): unused guest profiles and accounts are erased.
crons.interval('erase inactive guests and accounts', { hours: 24 }, internal.account.sweepInactive, {});
// The privacy policy: a closed report's contact details and message go after a year.
crons.interval('trim closed report details', { hours: 24 }, internal.retention.trimClosedReports, {});
// Old tombstones are safe to forget after devices have had 90 days to catch up.
crons.interval('prune library tombstones', { hours: 24 }, internal.retention.pruneLibraryTombstones, {});
// Blends: expired invite links, and Blends nobody joined before their first link ran out.
crons.interval('sweep blend invites and unjoined blends', { hours: 24 }, internal.blends.sweep, {});
// Spotify transfer is explicitly opted in per account. The scheduler only fans out bounded API steps.
crons.interval('run opted-in Spotify playlist transfers', { hours: 24 }, internal.spotifyCron.scheduleDaily, {});
crons.interval('sweep expired Spotify connect states', { hours: 24 }, internal.spotifyCron.sweepStates, {});

export default crons;
