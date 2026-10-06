/**
 * LuvLink state (Echo's LuvLinkClient flows, as one store).
 * The client writes it; the player menu, the room sheet and the join-request
 * card read it. Persisted: the name, the session (for reconnecting after the
 * app restarts) and Echo's LuvLink settings — auto-approve, blocked
 * people, host volume sync, smart resync and the server.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LuvLinkMemberSnapshot, LuvLinkPlaybackAnchor, LuvLinkQueueSnapshot, LuvLinkRoomSnapshot } from '@shared/luvLink';
import type {
  JoinRequestPayload,
  RoomState,
  SuggestionReceivedPayload,
} from '../services/luvLink/legacy/protocol';

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';
export type RoomRole = 'none' | 'host' | 'guest';

export interface StoredSession {
  token: string;
  roomCode: string;
  wasHost: boolean;
  /** Last time the server answered (joined, reconnected or a ping). */
  startedAt: number;
}

interface LuvLinkState {
  connection: ConnectionState;
  role: RoomRole;
  userId: string | null;
  room: RoomState | null;
  joinRequests: JoinRequestPayload[];
  suggestions: SuggestionReceivedPayload[];
  bufferingUsers: string[];
  /** A room code from an invite link, waiting to be joined. */
  inviteCode: string | null;
  /** Waiting for the host to let us in. */
  pendingJoinCode: string | null;
  /** One-line news for a toast ("Room ABC123 created", "Maya joined"). */
  notice: { id: number; text: string } | null;
  rttMs: number | null;

  // First-party Convex room state. Only the room id is persisted; invite codes are credentials
  // and stay in memory after create/regenerate, while legacy Echo sessions keep their old key.
  ownedRoomId: string | null;
  ownedRoom: LuvLinkRoomSnapshot | null;
  ownedMembers: LuvLinkMemberSnapshot[];
  ownedPresence: string[];
  ownedQueue: LuvLinkQueueSnapshot;
  ownedPlayback: LuvLinkPlaybackAnchor | null;
  ownedCode: string | null;
  /** An invite opened by a URL, kept in memory until the user joins or dismisses it. */
  pendingOwnedInviteCode: string | null;
  ownedConnection: 'idle' | 'connecting' | 'connected' | 'error';
  ownedUserId: string | null;
  clockOffsetMs: number;
  wallMinusMonotonicMs: number;

  // persisted
  username: string;
  autoApprove: boolean;
  session: StoredSession | null;
  /** Names whose join requests and suggestions are turned away (Echo's blocked users). */
  blocked: string[];
  /** Guests take the host's volume; the host sends theirs (Echo: on). */
  syncHostVolume: boolean;
  /** A guest asks for a fresh sync a second after reconnecting (Echo: on). */
  smartResync: boolean;
  /** A chosen server; empty = the one Echo publishes (server.json). */
  serverUrl: string;

  setUsername: (name: string) => void;
  setAutoApprove: (on: boolean) => void;
  block: (name: string) => void;
  unblock: (name: string) => void;
  setSyncHostVolume: (on: boolean) => void;
  setSmartResync: (on: boolean) => void;
  setServerUrl: (url: string) => void;
  announce: (text: string) => void;
  setOwnedRoomId: (roomId: string | null) => void;
}

/** A usable room server address: ws:// or wss://, nothing else. */
export const isServerUrl = (url: string): boolean => /^wss?:\/\/[^\s/]+/i.test(url.trim());

let noticeId = 0;

export const useLuvLinkStore = create<LuvLinkState>()(
  persist(
    set => ({
      connection: 'disconnected',
      role: 'none',
      userId: null,
      room: null,
      joinRequests: [],
      suggestions: [],
      bufferingUsers: [],
      pendingJoinCode: null,
      inviteCode: null,
      notice: null,
      rttMs: null,

      ownedRoomId: null,
      ownedRoom: null,
      ownedMembers: [],
      ownedPresence: [],
      ownedQueue: { revision: 0, entries: [] },
      ownedPlayback: null,
      ownedCode: null,
      pendingOwnedInviteCode: null,
      ownedConnection: 'idle',
      ownedUserId: null,
      clockOffsetMs: 0,
      wallMinusMonotonicMs: 0,

      username: '',
      autoApprove: false,
      session: null,
      blocked: [],
      syncHostVolume: true,
      smartResync: true,
      serverUrl: '',

      setUsername: name => set({ username: name.trim().slice(0, 32) }),
      setAutoApprove: on => set({ autoApprove: on }),
      block: name => set(s => ({
        blocked: s.blocked.includes(name) ? s.blocked : [...s.blocked, name],
        joinRequests: s.joinRequests.filter(r => r.username !== name),
        suggestions: s.suggestions.filter(x => x.from_username !== name),
      })),
      unblock: name => set(s => ({ blocked: s.blocked.filter(n => n !== name) })),
      setSyncHostVolume: on => set({ syncHostVolume: on }),
      setSmartResync: on => set({ smartResync: on }),
      setServerUrl: url => set({ serverUrl: isServerUrl(url) ? url.trim() : '' }),
      announce: text => set({ notice: { id: ++noticeId, text } }),
      setOwnedRoomId: ownedRoomId => set(ownedRoomId ? { ownedRoomId, ownedConnection: 'connecting' } : {
        ownedRoomId: null,
        ownedRoom: null,
        ownedMembers: [],
        ownedPresence: [],
        ownedQueue: { revision: 0, entries: [] },
        ownedPlayback: null,
        ownedCode: null,
        pendingOwnedInviteCode: null,
        ownedConnection: 'idle',
        ownedUserId: null,
        clockOffsetMs: 0,
        wallMinusMonotonicMs: 0,
      }),
    }),
    {
      name: 'luvlyrics-listen-together',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: s => ({
        username: s.username,
        autoApprove: s.autoApprove,
        session: s.session,
        blocked: s.blocked,
        syncHostVolume: s.syncHostVolume,
        smartResync: s.smartResync,
        serverUrl: s.serverUrl,
        ownedRoomId: s.ownedRoomId,
      }),
    },
  ),
);

