import { appendReleases, parseArtistReleases } from './browse';
const album = (id: string) => ({ musicTwoRowItemRenderer: { title: { runs: [{ text: id }] }, navigationEndpoint: { browseEndpoint: { browseId: `MPRE${id}` } } } });
it('reads artist grids and their continuation without needing home shelves', () => {
  const page = parseArtistReleases({ contents: { gridRenderer: { items: [album('one'), album('two')], continuations: [{ nextContinuationData: { continuation: 'next' } }] } } });
  expect(page.items.map(row => row.kind === 'song' ? '' : row.title)).toEqual(['one', 'two']);
  expect(page.continuation).toBe('next');
});
it('accepts continuation-only pages and deduplicates repeated albums', () => {
  const first = parseArtistReleases({ items: [album('one')] });
  const next = parseArtistReleases({ continuationContents: { gridContinuation: { items: [album('one'), album('two')] } }, continuationItemRenderer: { continuationEndpoint: { continuationCommand: { token: 'third' } } } });
  expect(appendReleases(first.items, next.items)).toHaveLength(2);
  expect(next.continuation).toBe('third');
});
it('handles missing and malformed renderer data without inventing releases', () => {
  expect(parseArtistReleases(null)).toEqual({ items: [], continuation: undefined });
  expect(parseArtistReleases({ items: [{ musicTwoRowItemRenderer: {} }] }).items).toEqual([]);
});
