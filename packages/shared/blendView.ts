/**
 * What the Blend routes send to the apps (docs/api-contract.md "Blend — additive"). Kept apart
 * from types.ts because the API reaches shared code only through `npm run sync:shared`.
 */
import type { Story } from './blendStories';
import type { BlendTrack, ChangeReason, PairMatch } from './blendTypes';

/** A member as other members see them: a display name and initials, never a photo or email (D11). */
export interface BlendMemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly initials: string;
  readonly isYou: boolean;
  /** False: their part comes from likes and playlists only (D12). */
  readonly learning: boolean;
}

/** A Blend in a list, and the reply to create, join and rename. */
export interface BlendSummary {
  readonly id: string;
  readonly name: string;
  readonly memberCount: number;
  readonly members: readonly BlendMemberView[];
  /** 'YYYY-MM-DD' of the last build, when there is one. */
  readonly builtFor?: string;
}

export interface BlendInviteLink {
  readonly code: string;
  readonly url: string;
  /** ms since epoch. */
  readonly expiresAt: number;
}

/** `POST /api/blends` reply: the new Blend and its first invite. */
export interface BlendCreated extends BlendSummary {
  readonly invite: BlendInviteLink;
}

/** `GET /api/blend-invites/:code`: enough to show "Asha invited you" before signing in. */
export interface BlendInvitePreview {
  readonly inviterName: string;
  readonly memberCount: number;
  readonly full: boolean;
}

export interface BlendDetail {
  readonly id: string;
  readonly name: string;
  /** The member who may rename it. */
  readonly ownerId: string;
  readonly members: readonly BlendMemberView[];
  readonly pairs: readonly PairMatch[];
  readonly change?: ChangeReason;
  readonly tracks: readonly BlendTrack[];
  readonly builtFor: string;
  readonly buildVersion?: number;
  readonly inputVersion?: number;
  readonly stale?: boolean;
  readonly status?: 'waiting' | 'refreshing' | 'ready' | 'not_enough';
  readonly state: 'ready' | 'not_enough';
  /** The cards for this viewer, in order; the apps only render them. */
  readonly stories: readonly Story[];
}
