import { cronJobs } from 'convex/server';

import { internal } from './_generated/api';

const crons = cronJobs();

// Spent OAuth codes and refresh tokens are only worth remembering until they expire.
crons.interval('sweep expired oauth grants', { hours: 24 }, internal.oauth.sweep, {});
// Keep the Connect command queue short-lived and prune long-inactive device registrations.
crons.interval('sweep Connect commands and stale devices', { minutes: 5 }, internal.connect.sweep, {});

export default crons;
