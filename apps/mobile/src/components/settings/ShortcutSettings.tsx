/**
 * Settings → Navigation: shortcuts into your playlists (1.41.0).
 *
 *   Library opens on        Songs · Playlists · Artists · Albums
 *   Hold Library for 2 s    opens one playlist straight away (or does nothing)
 *   Widget playlists        up to four, played from the home-screen widget without opening the app
 */
import React, { useMemo, useState } from 'react';
import { usePlaylistStore } from '../../store/playlistStore';
import {
  LIBRARY_START_TABS, togglePinnedPlaylist, useSettingsStore, WIDGET_PIN_LIMIT, type LibraryStartTab,
} from '../../store/settingsStore';
import { CheckRow, Sheet, SheetOption, SheetScrollView, Text } from '../../ui';
import { countOf } from '../../utils/formatters';
import { displayPlaylistName } from '../../utils/sentenceCase';
import { Action, Choice } from './SettingsKit';
import { holdSummary, pinnedSummary } from './shortcutSummary';

export const ShortcutSettings: React.FC = () => {
  const playlists = usePlaylistStore(s => s.playlists);
  const startTab = useSettingsStore(s => s.libraryStartTab);
  const setStartTab = useSettingsStore(s => s.setLibraryStartTab);
  const holdId = useSettingsStore(s => s.libraryHoldPlaylistId);
  const setHoldId = useSettingsStore(s => s.setLibraryHoldPlaylistId);
  const pinned = useSettingsStore(s => s.widgetPinnedPlaylistIds);
  const setPinned = useSettingsStore(s => s.setWidgetPinnedPlaylistIds);
  const [picker, setPicker] = useState<'hold' | 'widget' | null>(null);
  const names = useMemo(() => new Map(playlists.map(p => [p.id, displayPlaylistName(p.name)])), [playlists]);

  return (
    <>
      <Choice<LibraryStartTab>
        label="Library opens on"
        hint="The first thing you see when you open Library."
        value={startTab}
        options={LIBRARY_START_TABS.map(tab => ({ value: tab, label: tab }))}
        onChange={setStartTab}
      />
      <Action label="Hold Library for 2 seconds" hint="Opens one playlist straight away, such as your sleep playlist."
        value={holdSummary(holdId, names)} onPress={() => setPicker('hold')} />
      <Action label="Widget playlists" hint={`Up to ${WIDGET_PIN_LIMIT}. Tap one on the home-screen widget and it plays, even with the app closed.`}
        value={pinnedSummary(pinned, names)} onPress={() => setPicker('widget')} />

      <Sheet visible={picker === 'hold'} onClose={() => setPicker(null)} title="Hold Library opens" tall>
        <SheetScrollView>
          <SheetOption label="Off" selected={!holdId || !names.has(holdId)} onPress={() => { setHoldId(null); setPicker(null); }} />
          {playlists.map(p => (
            <SheetOption key={p.id} label={displayPlaylistName(p.name)} hint={countOf(p.songCount ?? 0, 'song')}
              selected={holdId === p.id} onPress={() => { setHoldId(p.id); setPicker(null); }} />
          ))}
        </SheetScrollView>
      </Sheet>

      <Sheet visible={picker === 'widget'} onClose={() => setPicker(null)} title="Widget playlists" tall>
        <Text variant="secondary" tone="secondary">{`${pinned.length} of ${WIDGET_PIN_LIMIT} chosen. Playlists play from songs saved on this phone, so they work with no connection.`}</Text>
        <SheetScrollView>
          {playlists.map(p => {
            const on = pinned.includes(p.id);
            return (
              <CheckRow key={p.id} label={displayPlaylistName(p.name)} detail={countOf(p.songCount ?? 0, 'song')} checked={on}
                disabled={!on && pinned.length >= WIDGET_PIN_LIMIT} onToggle={() => setPinned(togglePinnedPlaylist(pinned, p.id))} />
            );
          })}
        </SheetScrollView>
      </Sheet>
    </>
  );
};
