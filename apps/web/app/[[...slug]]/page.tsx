import { paths } from '../../src/lib/routes';

// Every path (/, /discover, /library, /liked, /artist/[name], /album, /playlist/[id],
// /shared/[code], /settings) is rendered by the persistent shell in app/layout.tsx.
// The page is the same empty HTML for all of them, so it is static: the CDN serves it
// instead of a function render on every page view. Fixed paths are built at deploy time;
// a parameterised one (/artist/x) is rendered on its first visit and cached from then on.
export const dynamic = 'force-static';

export function generateStaticParams(): Array<{ slug: string[] }> {
  return Object.values(paths).flatMap((path) => (typeof path === 'string' ? [{ slug: path.split('/').filter(Boolean) }] : []));
}

export default function Page() {
  return null;
}
