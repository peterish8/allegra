import { useSearchSessionStore } from './searchSessionStore';
test('Changing result type and leaving Search preserve the query, source and scroll position', () => {
  const store = useSearchSessionStore.getState();
  store.patch('search', { query: 'A long song title', scope: 'Online', active: true, offset: 300 });
  store.patch('search', { category: 'Albums' });
  store.patch('search', { active: false });
  expect(useSearchSessionStore.getState().sessions.search).toEqual({ query: 'A long song title', scope: 'Online', active: false, offset: 300, category: 'Albums' });
  expect(useSearchSessionStore.getState().sessions.stream.query).toBe('');
});
