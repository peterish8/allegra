import { Router, type Response } from 'express';

import type { AuthService } from '../auth/auth.js';
import { randomCode } from '../lib/randomCode.js';
import type { BlendBuildService } from '../services/blendBuild.js';
import { memberViews } from '../services/blendBuild.js';
import { BLEND_DISPLAY_NAME_MAX, BLEND_INVITE_CODE_LENGTH, BLEND_NAME_MAX } from '../shared/blendLimits.js';
import type { BlendInviteLink, BlendSummary } from '../shared/blendView.js';
import { POLICY_VERSION } from '../shared/legal.js';
import { BlendError, type BlendErrorCode, type BlendListEntry, type BlendStore } from '../user/blendStore.js';
import { isPersonalised, type UserData } from '../user/store.js';
import { asRecord, sendFailure, sendSuccess } from './common.js';
import { accountUser } from './imports.js';

/** PLAN.md §9. */
export const BLEND_COPY = {
  signin: "Sign in to make a Blend. Blends need an account so your friend knows it's you.",
  full: 'This Blend is full.',
  expired: 'This invite has expired. Ask for a new link.',
  notfound: "We couldn't find that Blend. The link may be wrong or the Blend may have ended.",
  limit: "You're in 20 Blends, the most there can be. Leave one to join this.",
  consent: 'Agree to how Blends use your listening before you blend.',
  invalid: "Something's missing from that request."
} as const;

const STATUS: Record<BlendErrorCode | 'consent', number> = { full: 409, limit: 409, expired: 410, notfound: 404, invalid: 400, consent: 400 };
const DEFAULT_NAME = 'Our Blend';

function fail(response: Response, code: BlendErrorCode | 'consent'): void {
  response.status(STATUS[code]).json({ success: false, data: null, error: BLEND_COPY[code], code });
}

function failure(response: Response, error: unknown): void {
  if (error instanceof BlendError) fail(response, error.code);
  else sendFailure(response, error);
}

/** `{ consent: { policyVersion } }` for the current policies, or null. */
function consentFrom(body: Record<string, unknown>, now: number): { policyVersion: string; at: number } | null {
  const consent = asRecord(body.consent);
  return consent.policyVersion === POLICY_VERSION ? { policyVersion: POLICY_VERSION, at: now } : null;
}

function displayNameOf(user: UserData): string {
  return (user.displayName ?? '').trim().slice(0, BLEND_DISPLAY_NAME_MAX) || 'Listener';
}

function summaryOf(entry: Pick<BlendListEntry, 'id' | 'name' | 'memberCount' | 'builtFor' | 'members'>, viewerId: string): BlendSummary {
  return {
    id: entry.id,
    name: entry.name,
    memberCount: entry.memberCount,
    members: memberViews(entry.members, viewerId),
    ...(entry.builtFor ? { builtFor: entry.builtFor } : {})
  };
}

/**
 * Blends (PLAN.md B3). Account only; behind BLEND_ENABLED. A Blend id that is not yours answers
 * exactly like one that does not exist (never "forbidden"), so ids reveal nothing.
 */
export function blendsRouter(deps: {
  readonly auth: AuthService;
  readonly blends: BlendStore;
  readonly builder: BlendBuildService;
  readonly enabled: boolean;
  readonly origin?: string;
  readonly now?: () => number;
}): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const linkOf = (code: string, expiresAt: number): BlendInviteLink => ({ code, url: `${deps.origin ?? ''}/blend/join/${code}`, expiresAt });

  router.use(['/blends', '/blend-invites'], (_request, response, next) => {
    if (deps.enabled) {
      next();
      return;
    }
    response.status(404).json({ success: false, data: null, error: "We couldn't find that." });
  });

  const signedIn = (request: Parameters<typeof accountUser>[1], response: Response) => accountUser(deps.auth, request, response, BLEND_COPY.signin);
  const summary = async (blendId: string, user: UserData): Promise<BlendSummary> => {
    const stored = await deps.blends.get(blendId, user.userId);
    if (!stored) throw new BlendError('notfound');
    return summaryOf(stored, user.userId);
  };
  /** D6: a listener's first Blend action seeds their tally from what they already did here. */
  const seed = async (user: UserData): Promise<void> => {
    if (!isPersonalised(user)) return;
    try {
      await deps.builder.seedTally(user);
    } catch {
      // Derived data: the Blend still works from likes and playlists.
    }
  };

  router.post('/blends', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    const body = asRecord(request.body);
    const requestId = request.get('Idempotency-Key')?.trim();
    if (requestId !== undefined && !/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
      fail(response, 'invalid');
      return;
    }
    const consent = consentFrom(body, now());
    if (!consent) {
      fail(response, 'consent');
      return;
    }
    const name = body.name === undefined ? DEFAULT_NAME : typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > BLEND_NAME_MAX) {
      fail(response, 'invalid');
      return;
    }
    try {
      const created = await deps.blends.create({
        userId: user.userId,
        displayName: displayNameOf(user),
        name,
        consent,
        learning: isPersonalised(user),
        code: randomCode(BLEND_INVITE_CODE_LENGTH),
        ...(requestId ? { operationId: requestId } : {})
      });
      await seed(user);
      sendSuccess(response, { ...(await summary(created.blendId, user)), invite: linkOf(created.code, created.expiresAt) }, 201);
    } catch (error) {
      failure(response, error);
    }
  });

  router.get('/blends', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    try {
      sendSuccess(response, (await deps.blends.listForUser(user.userId)).map((entry) => summaryOf(entry, user.userId)));
    } catch (error) {
      failure(response, error);
    }
  });

  router.get('/blends/:id', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    try {
      const detail = await deps.builder.detailFor(String(request.params.id), user.userId);
      if (!detail) fail(response, 'notfound');
      else sendSuccess(response, detail);
    } catch (error) {
      failure(response, error);
    }
  });

  router.post('/blends/:id/invite', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    const regenerate = asRecord(request.body).regenerate === true;
    try {
      const invite = await deps.blends.invite(String(request.params.id), user.userId, randomCode(BLEND_INVITE_CODE_LENGTH), regenerate);
      sendSuccess(response, linkOf(invite.code, invite.expiresAt));
    } catch (error) {
      failure(response, error);
    }
  });

  router.post('/blends/:id/leave', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    try {
      await deps.blends.leave(String(request.params.id), user.userId);
      sendSuccess(response, { left: true });
    } catch (error) {
      failure(response, error);
    }
  });

  router.patch('/blends/:id', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    const name = asRecord(request.body).name;
    if (typeof name !== 'string' || !name.trim() || name.trim().length > BLEND_NAME_MAX) {
      fail(response, 'invalid');
      return;
    }
    try {
      const blendId = String(request.params.id);
      await deps.blends.rename(blendId, user.userId, name);
      sendSuccess(response, await summary(blendId, user));
    } catch (error) {
      failure(response, error);
    }
  });

  // Anyone with the link may see who invited them, signed in or not; unknown, malformed and
  // expired codes all answer the same notfound.
  router.get('/blend-invites/:code', async (request, response) => {
    try {
      const preview = await deps.blends.preview(String(request.params.code), now());
      if (preview.status !== 'ok') {
        fail(response, 'notfound');
        return;
      }
      sendSuccess(response, { inviterName: preview.inviterName, memberCount: preview.memberCount, full: preview.full });
    } catch (error) {
      failure(response, error);
    }
  });

  router.post('/blend-invites/:code/accept', async (request, response) => {
    const user = await signedIn(request, response);
    if (!user) return;
    const consent = consentFrom(asRecord(request.body), now());
    if (!consent) {
      fail(response, 'consent');
      return;
    }
    try {
      const joined = await deps.blends.join({
        code: String(request.params.code),
        userId: user.userId,
        displayName: displayNameOf(user),
        consent,
        learning: isPersonalised(user)
      });
      await seed(user);
      sendSuccess(response, await summary(joined.blendId, user));
    } catch (error) {
      failure(response, error);
    }
  });

  return router;
}
