/**
 * "Saved in" — Spotify's add-to-playlist sheet, opened by the mini player's ⊕ / ✓ and the song menus.
 *
 * It opens short over the page and pulls up to full height (`Sheet expandable`): the drag follows the finger,
 * a release is thrown to the nearest rest. At full height a Cancel · Done bar fades into the top band.
 *
 * Top: "Saved in" with New playlist, then the playlists that held the song when it opened (Liked songs first),
 * ticked. They keep their place when unticked, so a slip is one tap to undo. Then Find playlist / Sort and every
 * other playlist with ⊕. Where the song is saved is written only on Done; Cancel, the scrim, back or a swipe down
 * leave it as it was. (New playlist creates its playlist at once, as Spotify does; the song joins it only on Done.)
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TextInput, View } from 'react-native';

import { applySavedIn, canSaveIn, loadSavedIn } from '../services/savedIn';
import { membershipChanges } from '../services/savedInChanges';
import { usePlaylistStore } from '../store/playlistStore';
import { useSavedInStore } from '../store/savedInStore';
import type { Playlist, Song } from '../types/song';
import {
  Button, Glass, Haptics, ListRow, MorphIcon, OnMedia, Radius, Sheet, SheetScrollable, Signal, Space, Surface, Text,
  TextButton, Typography, useSheet,
} from '../ui';
import { displayPlaylistName } from '../utils/sentenceCase';

type Sort = 'recent' | 'name';

const countLabel = (playlist: Playlist): string | undefined =>
  playlist.songCount === undefined ? undefined : playlist.songCount === 1 ? '1 song' : `${playlist.songCount} songs`;

/** Mounted once at the root; opens for whichever song `openSavedIn` names. */
export default function SavedInSheet(): React.ReactElement | null {
  const song = useSavedInStore(state => state.song);
  const openedAt = useSavedInStore(state => state.openedAt);
  const close = useSavedInStore(state => state.close);
  // The sheet keeps its content while it slides away after closing. The open song is read during render, so a
  // reopen swaps straight to a fresh sheet (keyed by when it opened) without one frame of the old one.
  const [last, setLast] = useState<{ song: Song; openedAt: number } | null>(null);
  useEffect(() => { if (song) setLast({ song, openedAt }); }, [song, openedAt]);
  const shown = song ? { song, openedAt } : last;
  if (!shown) return null;
  return <SavedInBody key={shown.openedAt} song={shown.song} visible={!!song} onClose={close} />;
}

function SavedInBody({ song, visible, onClose }: { song: Song; visible: boolean; onClose: () => void }): React.ReactElement {
  const ready = useSavedInStore(state => state.ready);
  const [before, setBefore] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // The rows that start in "Saved in", in the order they were shown: they never jump while being toggled.
  const [pinned, setPinned] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  // A failed read must never look like "saved nowhere": that would offer Done a diff that un-likes the song.
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  /** One Done at a time: two taps (top bar and pill) must not write the same edits twice. */
  const inFlight = useRef(false);

  useEffect(() => {
    let current = true;
    setLoadFailed(false);
    ready.catch(() => undefined).then(() => loadSavedIn(song)).then(held => {
      if (!current) return;
      const { playlists, defaultPlaylistId } = usePlaylistStore.getState();
      setBefore(held);
      setSelected(new Set(held));
      setPinned(playlists.filter(p => held.has(p.id)).sort((a, b) => Number(b.id === defaultPlaylistId) - Number(a.id === defaultPlaylistId)).map(p => p.id));
    }, () => { if (current) setLoadFailed(true); });
    return () => { current = false; };
  }, [song, ready, attempt]);

  const changed = useMemo(() => {
    if (!before) return false;
    const { add, remove } = membershipChanges(before, selected);
    return add.length + remove.length > 0;
  }, [before, selected]);

  const done = useCallback(async () => {
    if (inFlight.current) return;
    if (!before || !changed) { onClose(); return; }
    inFlight.current = true;
    setSaving(true);
    setFailed(false);
    try {
      const ok = await applySavedIn(song, before, selected);
      if (ok) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        onClose();
        return;
      }
      setFailed(true);
      // Re-base on what actually landed, so "Done" again only redoes what didn't.
      setBefore(await loadSavedIn(song).catch(() => before));
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [before, changed, song, selected, onClose]);

  const topBar = (
    <View style={styles.topBar}>
      <TextButton label="Cancel" onPress={onClose} />
      <TextButton label="Done" tone="accent" onPress={done} />
    </View>
  );
  const footer = (
    <Button label="Done" variant="primary" busy={saving} onPress={done} style={styles.donePill} />
  );

  return (
    <Sheet visible={visible} onClose={onClose} expandable keyboard topBar={topBar} footer={footer}>
      <SavedInList
        song={song}
        loading={before === null && !loadFailed}
        loadFailed={loadFailed}
        onRetryLoad={() => setAttempt(n => n + 1)}
        selected={selected}
        pinned={pinned}
        failed={failed}
        onToggle={id => {
          Haptics.selectionAsync().catch(() => {});
          setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          });
        }}
        onCreated={id => {
          setPinned(prev => [...prev, id]);
          setSelected(prev => new Set(prev).add(id));
        }}
      />
    </Sheet>
  );
}

interface ListProps {
  song: Song;
  loading: boolean;
  /** Reading where the song is saved failed: show why and a retry, and offer no rows to edit. */
  loadFailed: boolean;
  onRetryLoad: () => void;
  selected: ReadonlySet<string>;
  pinned: readonly string[];
  failed: boolean;
  onToggle: (playlistId: string) => void;
  onCreated: (playlistId: string) => void;
}

/** The sheet's content. A child of the Sheet, so it can expand it (a search field or name field taking focus). */
function SavedInList({ song, loading, loadFailed, onRetryLoad, selected, pinned, failed, onToggle, onCreated }: ListProps): React.ReactElement {
  const sheet = useSheet();
  const playlists = usePlaylistStore(state => state.playlists);
  const likedId = usePlaylistStore(state => state.defaultPlaylistId);
  const createPlaylist = usePlaylistStore(state => state.createPlaylist);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('recent');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const byId = useMemo(() => new Map(playlists.map(p => [p.id, p])), [playlists]);
  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);
  const savedRows = useMemo(() => {
    // Liked songs is always in the top group, ticked or not: it is where ⊕ saves first.
    const ids = likedId && !pinnedSet.has(likedId) ? [likedId, ...pinned] : pinned;
    return ids.map(id => byId.get(id)).filter((p): p is Playlist => !!p);
  }, [pinned, pinnedSet, likedId, byId]);
  const others = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rest = playlists.filter(p => !pinnedSet.has(p.id) && p.id !== likedId && !p.id.startsWith('generated:'));
    const found = needle ? rest.filter(p => displayPlaylistName(p.name).toLowerCase().includes(needle)) : rest;
    return sort === 'name' ? [...found].sort((a, b) => displayPlaylistName(a.name).localeCompare(displayPlaylistName(b.name))) : found;
  }, [playlists, pinnedSet, likedId, query, sort]);

  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const id = await createPlaylist(trimmed);
      onCreated(id);
      setNaming(false);
      setName('');
    } catch {
      // The field stays open with the name, so another tap retries.
    } finally {
      setCreating(false);
    }
  };

  const row = (playlist: Playlist) => {
    const isLiked = playlist.id === likedId;
    const on = selected.has(playlist.id);
    const title = isLiked ? 'Liked songs' : displayPlaylistName(playlist.name);
    return (
      <ListRow
        key={playlist.id}
        title={title}
        subtitle={isLiked ? undefined : countLabel(playlist)}
        icon={isLiked ? 'heart' : undefined}
        artwork={isLiked ? undefined : { uri: playlist.coverImageUri, title }}
        onPress={() => onToggle(playlist.id)}
        checked={on}
        trailing={<MorphIcon on={on} onIcon="checkmark-circle" offIcon="add-circle-outline" size={26} color={on ? Signal.wave : OnMedia.secondary} />}
      />
    );
  };

  const header = (
    <View>
      <View style={styles.titleRow}>
        <Text variant="detail" accessibilityRole="header">Saved in</Text>
        {naming ? null : <TextButton label="New playlist" tone="accent" onPress={() => { setNaming(true); sheet?.expand(); }} />}
      </View>
      {naming ? (
        <View style={styles.nameRow}>
          <TextInput
            style={[styles.field, styles.grow]}
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor={Signal.inkFaint}
            selectionColor={Signal.wave}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={create}
            accessibilityLabel="New playlist name"
          />
          <Button label="Create" size="sm" variant="primary" busy={creating} disabled={!name.trim()} onPress={create} />
        </View>
      ) : null}
      {failed ? <Text variant="secondary" tone="danger" style={styles.notice}>Couldn’t save every change. Try Done again.</Text> : null}
      {!canSaveIn(song) ? <Text variant="secondary" tone="muted" style={styles.notice}>This song can’t be saved to playlists yet.</Text> : null}
      {loadFailed ? (
        <View style={styles.notice}>
          <Text variant="secondary" tone="danger">Couldn’t load your playlists.</Text>
          <TextButton label="Try again" tone="accent" onPress={onRetryLoad} />
        </View>
      ) : loading ? <ActivityIndicator color={Signal.wave} style={styles.loading} /> : savedRows.map(row)}
      <View style={styles.divider} />
      <View style={styles.searchRow}>
        <View style={[styles.field, styles.search, styles.grow]}>
          <Ionicons name="search" size={18} color={Signal.inkMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            onFocus={() => sheet?.expand()}
            placeholder="Find playlist"
            placeholderTextColor={Signal.inkFaint}
            selectionColor={Signal.wave}
            accessibilityLabel="Find playlist"
          />
        </View>
        <Button
          label={sort === 'recent' ? 'Recent' : 'A–Z'}
          size="sm"
          accessibilityLabel={sort === 'recent' ? 'Sorted by recent. Sort by name' : 'Sorted by name. Sort by recent'}
          onPress={() => setSort(prev => (prev === 'recent' ? 'name' : 'recent'))}
        />
      </View>
    </View>
  );

  return (
    <SheetScrollable>
      <FlatList
        data={loading || loadFailed ? [] : others}
        keyExtractor={item => item.id}
        renderItem={({ item }) => row(item)}
        ListHeaderComponent={header}
        ListEmptyComponent={loading || loadFailed ? null : (
          <Text variant="secondary" tone="muted" style={styles.notice}>{query ? 'No playlists match.' : 'No other playlists yet.'}</Text>
        )}
        keyboardShouldPersistTaps="handled"
        style={styles.list}
        contentContainerStyle={styles.listContent}
        initialNumToRender={14}
      />
    </SheetScrollable>
  );
}

const styles = StyleSheet.create({
  topBar: { ...StyleSheet.absoluteFillObject, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Space.xs },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginBottom: Space.sm },
  grow: { flex: 1 },
  field: { ...Typography.body, color: Signal.ink, backgroundColor: Glass.fillLight, borderRadius: Radius.control, paddingHorizontal: Space.sm, minHeight: 44 },
  search: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  searchInput: { ...Typography.body, flex: 1, color: Signal.ink, paddingVertical: Space.xs },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.md, marginBottom: Space.sm },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Surface.divider, marginTop: Space.sm },
  notice: { marginVertical: Space.sm },
  loading: { marginVertical: Space.lg },
  list: { flex: 1 },
  // Room under the last row for the floating Done.
  listContent: { paddingBottom: Space.xxl * 2 },
  donePill: { minWidth: 132 },
});
