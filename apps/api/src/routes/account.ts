import { Router } from 'express';

import type { AuthService } from '../auth/auth.js';
import { POLICY_VERSION } from '../shared/legal.js';
import { currentWeight } from '../shared/blendDecay.js';
import { isTombstone, type LibraryChange } from '../shared/library.js';
import type { UserData, UserStore } from '../user/store.js';
import type { TasteTally } from '../user/tasteTally.js';
import type { BlendStore } from '../user/blendStore.js';
import { callerProfile, publicProfile, sendUnauthorized } from './auth.js';
import { asRecord, sanitizeSettings, sendFailure, sendSuccess } from './common.js';

/** Library pages read for one export. Past this the export says it is incomplete rather than running on. */
const EXPORT_PAGES = 20;
const EXPORT_PAGE_SIZE = 500;

/**
 * What a listener is owed about their own data: a record that they agreed to the policies, a
 * copy of everything held about them, and a way to have it erased. Works for a guest session
 * as well as an account. Reply shapes are docs/api-contract.md.
 */
export function accountRouter(auth: AuthService, users: UserStore, tally: TasteTally, blends: BlendStore): Router {
  const router = Router();

  // Sent once after sign-in, when the listener ticked the box in the sign-in dialog.
  router.post('/me/consent', async (request, response) => {
    try {
      const user = await callerProfile(auth, request);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      // Agreeing to a version that is not the one on the site is not agreement to anything.
      if (asRecord(request.body).policyVersion !== POLICY_VERSION) {
        response.status(400).json({ success: false, data: null, error: 'Those terms have been updated. Reload the page and try again.' });
        return;
      }
      const saved = await auth.recordConsent(user, POLICY_VERSION);
      if (!saved) {
        sendUnauthorized(response);
        return;
      }
      sendSuccess(response, publicProfile(saved));
    } catch (error) {
      sendFailure(response, error);
    }
  });

  router.get('/me/export', async (request, response) => {
    try {
      const user = await callerProfile(auth, request);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      const now = Date.now();
      const [library, extras, tallyRows, blendRows] = await Promise.all([
        libraryOf(auth, user),
        users.accountExtras(user.userId),
        tally.top(user.userId, 200),
        blends.listForUser(user.userId)
      ]);
      sendSuccess(response, {
        complete: library.complete && extras.complete,
        exportedAt: new Date().toISOString(),
        policyVersion: POLICY_VERSION,
        profile: publicProfile(user),
        settings: sanitizeSettings(user.settings),
        taste: user.taste ?? null,
        tally: tallyRows.map(({ title, artist, score }) => ({ title, artist, weight: Math.round(currentWeight(score, now)) })),
        recentlyPlayed: user.recentlyPlayed,
        library,
        shares: extras.shares,
        devices: extras.devices,
        luvLinks: extras.luvLinks,
        blends: blendRows.map((blend) => ({
          name: blend.name,
          joinedAt: new Date(blend.joinedAt).toISOString(),
          members: blend.members.map((member) => member.displayName)
        }))
      });
    } catch (error) {
      sendFailure(response, error);
    }
  });

  // The website asks "are you sure" before calling this; here it is final.
  router.delete('/me', async (request, response) => {
    try {
      const user = await callerProfile(auth, request);
      if (!user) {
        sendUnauthorized(response);
        return;
      }
      await auth.deleteAccount(user.userId);
      // In Convex the erase already left every Blend; the memory store needs telling.
      await blends.forget?.(user.userId);
      response.status(204).end();
    } catch (error) {
      sendFailure(response, error);
    }
  });

  return router;
}

/** Every like, playlist and playlist song the listener has now, as the sync feed describes them. */
async function libraryOf(auth: AuthService, user: UserData): Promise<{ readonly changes: LibraryChange[]; readonly complete: boolean }> {
  const changes: LibraryChange[] = [];
  let since = 0;
  for (let page = 0; page < EXPORT_PAGES; page++) {
    const result = await auth.library.changes(user.userId, since, EXPORT_PAGE_SIZE);
    // Past the first page the feed includes remembered deletes; an export is what exists now.
    changes.push(...result.changes.filter((change) => !isTombstone(change)));
    if (!result.more) return { changes, complete: true };
    since = result.rev;
  }
  return { changes, complete: false };
}
