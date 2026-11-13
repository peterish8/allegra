import { create } from 'zustand';
export type SearchCategory = 'All' | 'Songs' | 'Artists' | 'Albums' | 'Playlists';
export type SearchScope = 'All' | 'On this phone' | 'Online';
export type SearchOrigin = 'stream' | 'search';
export interface SearchSession { query: string; category: SearchCategory; scope: SearchScope; active: boolean; offset: number }
const empty = (): SearchSession => ({ query: '', category: 'All', scope: 'All', active: false, offset: 0 });
export const useSearchSessionStore = create<{
  sessions: Record<SearchOrigin, SearchSession>;
  patch: (origin: SearchOrigin, values: Partial<SearchSession>) => void;
}>((set) => ({
  sessions: { stream: empty(), search: empty() },
  patch: (origin, values) => set(state => ({ sessions: { ...state.sessions, [origin]: { ...state.sessions[origin], ...values } } })),
}));
