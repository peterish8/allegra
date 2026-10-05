/**
 * The app's URL space, in one place. The shell reads the pathname through
 * parseRoute; everything that navigates builds its href through `paths`.
 */
import { LEGAL_PATHS, type LegalDocument } from '@shared/legal';

import { flags as defaultFlags, type Flags } from './flags';

export type AppView =
  | 'home' | 'discover' | 'library' | 'album' | 'artist' | 'playlist' | 'liked' | 'shared' | 'settings'
  | 'import' | 'blends' | 'blend' | 'blendJoin'
  | LegalDocument;

export function isLegalView(view: AppView): view is LegalDocument {
  return view === 'privacy' || view === 'terms' || view === 'copyright';
}

export interface Route {
  readonly view: AppView;
  readonly artistName: string | null;
  readonly playlistId: string | null;
  readonly sharedCode: string | null;
  /** `/blend/:id`. */
  readonly blendId: string | null;
  /** `/blend/join/:code`. */
  readonly inviteCode: string | null;
}

export const paths = {
  home: '/',
  discover: '/discover',
  library: '/library',
  liked: '/liked',
  album: '/album',
  settings: '/settings',
  import: '/import',
  blends: '/blends',
  ...LEGAL_PATHS,
  blend: (id: string): string => `/blend/${encodeURIComponent(id)}`,
  blendJoin: (code: string): string => `/blend/join/${encodeURIComponent(code)}`,
  artist: (name: string): string => `/artist/${encodeURIComponent(name)}`,
  playlist: (id: string): string => `/playlist/${encodeURIComponent(id)}`,
  shared: (code: string): string => `/shared/${encodeURIComponent(code)}`
} as const;

const NO_PARAMS: Omit<Route, 'view'> = { artistName: null, playlistId: null, sharedCode: null, blendId: null, inviteCode: null };

function decode(segment: string | undefined): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment).trim() || null;
  } catch {
    return null;
  }
}

/** `enabled` gates the routes behind feature flags; off, they fall back as an unknown path would. */
export function parseRoute(pathname: string, enabled: Flags = defaultFlags): Route {
  const [first, second, third] = pathname.split('/').filter(Boolean);
  switch (first) {
    case 'import':
      return { view: enabled.import ? 'import' : 'home', ...NO_PARAMS };
    case 'blends':
      return { view: enabled.blend ? 'blends' : 'home', ...NO_PARAMS };
    case 'blend': {
      if (!enabled.blend) return { view: 'home', ...NO_PARAMS };
      if (second === 'join') {
        const inviteCode = decode(third)?.toLowerCase() ?? null;
        return inviteCode ? { view: 'blendJoin', ...NO_PARAMS, inviteCode } : { view: 'blends', ...NO_PARAMS };
      }
      const blendId = decode(second);
      return blendId ? { view: 'blend', ...NO_PARAMS, blendId } : { view: 'blends', ...NO_PARAMS };
    }
    case 'discover':
      return { view: 'discover', ...NO_PARAMS };
    case 'library':
      return { view: 'library', ...NO_PARAMS };
    case 'liked':
      return { view: 'liked', ...NO_PARAMS };
    case 'album':
      return { view: 'album', ...NO_PARAMS };
    case 'settings':
      return { view: 'settings', ...NO_PARAMS };
    case 'privacy':
    case 'terms':
    case 'copyright':
      return { view: first, ...NO_PARAMS };
    case 'artist': {
      const artistName = decode(second);
      return artistName ? { view: 'artist', ...NO_PARAMS, artistName } : { view: 'home', ...NO_PARAMS };
    }
    case 'playlist': {
      const playlistId = decode(second);
      return playlistId ? { view: 'playlist', ...NO_PARAMS, playlistId } : { view: 'library', ...NO_PARAMS };
    }
    case 'shared': {
      const sharedCode = decode(second)?.toLowerCase() ?? null;
      return sharedCode ? { view: 'shared', ...NO_PARAMS, sharedCode } : { view: 'home', ...NO_PARAMS };
    }
    default:
      return { view: 'home', ...NO_PARAMS };
  }
}

/** Links shared before the move to real URLs (`/#shared/abc`, `/#artist/x`) keep working. */
export function legacyHashToPath(hash: string): string | null {
  if (!hash.startsWith('#')) return null;
  const body = hash.slice(1);
  const [head, ...rest] = body.split('/');
  const tail = rest.join('/');
  switch (head) {
    case 'home':
      return paths.home;
    case 'discover':
    case 'library':
    case 'liked':
    case 'album':
      return `/${head}`;
    case 'artist':
    case 'playlist':
    case 'shared':
      return tail ? `/${head}/${tail}` : null;
    default:
      return null;
  }
}
