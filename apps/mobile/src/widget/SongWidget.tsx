/**
 * Home-screen widgets (Android, react-native-android-widget).
 *
 * NowPlayingWidget — the reference card: a soft frame around the cover
 * full-bleed, a frosted pill up top with the song, share + like circles,
 * then elapsed / remaining time, a progress hairline and round transport
 * buttons over a dark fade at the foot.
 *
 * PlaylistWidget — up to four pinned playlists as tiles; a tap plays one in
 * the background without opening the app (1.41.0), and the header shows the
 * song playing with play/pause.
 *
 * RemoteViews can't blur, so "frosted" is a dark translucent fill over the
 * cover, and every glyph is an inline SVG (icons.ts).
 */
import React from 'react';
import { FlexWidget, ImageWidget, OverlapWidget, SvgWidget, TextWidget } from 'react-native-android-widget';
import type { ColorProp } from 'react-native-android-widget';
import { Icon } from './icons';
import { formatClock, widgetLink, WidgetPin, WidgetSnapshot } from './widgetData';

const INK = '#F4F1EA';
const INK_MUTED = '#A9ADB2';
const WAVE = '#F4F4F5';
const CORAL = '#EE6B5F';
const FRAME = '#1B1C20';
const GLASS: ColorProp = 'rgba(38, 39, 44, 0.78)';
const GLASS_LIGHT: ColorProp = 'rgba(24, 25, 30, 0.55)';

type ImageSource = React.ComponentProps<typeof ImageWidget>['image'];
const asImage = (uri: string) => uri as ImageSource;

// ─── Small parts ────────────────────────────────────────────────────────────

const RoundButton: React.FC<{
  size: number;
  icon: string;
  iconSize: number;
  action: string;
  data?: Record<string, unknown>;
  fill?: ColorProp;
  label: string;
}> = ({ size, icon, iconSize, action, data, fill = GLASS, label }) => (
  <FlexWidget
    clickAction={action}
    clickActionData={data}
    accessibilityLabel={label}
    style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: fill,
      justifyContent: 'center',
      alignItems: 'center',
    }}
  >
    <SvgWidget svg={icon} style={{ width: iconSize, height: iconSize }} />
  </FlexWidget>
);

const Cover: React.FC<{ uri?: string; size: number; radius: number }> = ({ uri, size, radius }) =>
  uri ? (
    <ImageWidget image={asImage(uri)} imageWidth={size} imageHeight={size} radius={radius} />
  ) : (
    <FlexWidget
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundGradient: { from: '#3A2F4A', to: '#16181D', orientation: 'TL_BR' },
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <SvgWidget svg={Icon.note(INK_MUTED)} style={{ width: size * 0.4, height: size * 0.4 }} />
    </FlexWidget>
  );

// ─── Now playing ────────────────────────────────────────────────────────────

export const NowPlayingWidget: React.FC<{ snapshot: WidgetSnapshot; width: number; height: number }> = ({
  snapshot,
  width,
  height,
}) => {
  const { song, isPlaying, liked, position, duration } = snapshot;
  const pad = 8;
  const inner = Math.max(120, Math.min(width, height) - pad * 2);
  const compact = inner < 190;
  const btn = compact ? 34 : 44;
  const playBtn = compact ? 40 : 52;
  const barWidth = inner - 32;
  const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;
  const filled = Math.max(4, Math.round(barWidth * progress));

  if (!song) {
    return (
      <FlexWidget
        clickAction="OPEN_APP"
        style={{
          width: 'match_parent',
          height: 'match_parent',
          borderRadius: 28,
          backgroundGradient: { from: '#24202C', to: '#101114', orientation: 'TL_BR' },
          justifyContent: 'center',
          alignItems: 'center',
          padding: 16,
        }}
      >
        <SvgWidget svg={Icon.note(WAVE)} style={{ width: 30, height: 30 }} />
        <TextWidget text="Nothing playing" style={{ fontSize: 16, fontWeight: '600', color: INK, marginTop: 10 }} />
        <TextWidget text="Tap to open LuvLyrics" style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }} />
      </FlexWidget>
    );
  }

  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        borderRadius: 32,
        backgroundColor: FRAME,
        justifyContent: 'center',
        alignItems: 'center',
        padding: pad,
      }}
    >
      <OverlapWidget style={{ width: inner, height: inner, borderRadius: 26 }}>
        {/* Cover, full-bleed */}
        {song.cover ? (
          <ImageWidget image={asImage(song.cover)} imageWidth={inner} imageHeight={inner} radius={26} clickAction="OPEN_URI" clickActionData={{ uri: widgetLink.nowPlaying() }} />
        ) : (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: widgetLink.nowPlaying() }}
            style={{ width: inner, height: inner, borderRadius: 26, backgroundGradient: { from: '#4A3558', to: '#15161B', orientation: 'TL_BR' } }}
          />
        )}

        {/* Legibility: light at the top, deep at the foot */}
        <FlexWidget style={{ width: inner, height: inner, flexDirection: 'column' }}>
          <FlexWidget style={{ width: inner, height: inner * 0.3, borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundGradient: { from: 'rgba(8, 9, 12, 0.45)', to: 'rgba(8, 9, 12, 0)', orientation: 'TOP_BOTTOM' } }} />
          <FlexWidget style={{ width: inner, height: inner * 0.25 }} />
          <FlexWidget style={{ width: inner, height: inner * 0.45, borderBottomLeftRadius: 26, borderBottomRightRadius: 26, backgroundGradient: { from: 'rgba(8, 9, 12, 0)', to: 'rgba(8, 9, 12, 0.88)', orientation: 'TOP_BOTTOM' } }} />
        </FlexWidget>

        {/* Controls */}
        <FlexWidget style={{ width: inner, height: inner, flexDirection: 'column', padding: compact ? 10 : 14 }}>
          {/* Top: song pill + share + like */}
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center' }}>
            <FlexWidget
              clickAction="OPEN_URI"
              clickActionData={{ uri: widgetLink.nowPlaying() }}
              style={{
                flex: 1,
                height: btn,
                borderRadius: btn / 2,
                backgroundColor: GLASS,
                flexDirection: 'row',
                alignItems: 'center',
                paddingLeft: 4,
                paddingRight: 12,
              }}
            >
              <Cover uri={song.cover} size={btn - 8} radius={(btn - 8) / 2} />
              {compact ? null : (
                <FlexWidget style={{ flex: 1, flexDirection: 'column', marginLeft: 8 }}>
                  <TextWidget text={song.title} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: '700', color: INK }} />
                  <TextWidget text={song.artist || 'Unknown artist'} maxLines={1} truncate="END" style={{ fontSize: 11, color: INK_MUTED }} />
                </FlexWidget>
              )}
            </FlexWidget>
            <FlexWidget style={{ width: 8, height: 1 }} />
            <RoundButton size={btn} iconSize={compact ? 16 : 20} icon={Icon.share(INK)} action="OPEN_URI" data={{ uri: widgetLink.share() }} label="Share" />
            <FlexWidget style={{ width: 8, height: 1 }} />
            <RoundButton size={btn} iconSize={compact ? 16 : 20} icon={liked ? Icon.heart(CORAL) : Icon.heartOutline(INK)} action="TOGGLE_LIKE" label={liked ? 'Unlike' : 'Like'} />
          </FlexWidget>

          <FlexWidget style={{ flex: 1, width: 'match_parent' }} />

          {/* Time + progress */}
          {compact ? null : (
            <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginBottom: 6 }}>
              <TextWidget text={formatClock(position)} style={{ fontSize: 12, fontWeight: '600', color: INK }} />
              <TextWidget text={`-${formatClock(duration - position)}`} style={{ fontSize: 12, fontWeight: '600', color: INK }} />
            </FlexWidget>
          )}
          <FlexWidget style={{ width: barWidth, height: 4, borderRadius: 2, backgroundColor: 'rgba(255, 255, 255, 0.26)', flexDirection: 'row' }}>
            <FlexWidget style={{ width: filled, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF' }} />
          </FlexWidget>

          {/* Transport */}
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: compact ? 8 : 12 }}>
            <RoundButton size={btn} iconSize={compact ? 16 : 20} icon={Icon.previous(INK)} action="PREVIOUS" label="Previous" fill={GLASS_LIGHT} />
            <FlexWidget style={{ width: compact ? 10 : 18, height: 1 }} />
            <RoundButton size={playBtn} iconSize={compact ? 20 : 24} icon={isPlaying ? Icon.pause(INK) : Icon.play(INK)} action="TOGGLE_PLAY" label={isPlaying ? 'Pause' : 'Play'} fill={GLASS_LIGHT} />
            <FlexWidget style={{ width: compact ? 10 : 18, height: 1 }} />
            <RoundButton size={btn} iconSize={compact ? 16 : 20} icon={Icon.next(INK)} action="NEXT" label="Next" fill={GLASS_LIGHT} />
          </FlexWidget>
        </FlexWidget>
      </OverlapWidget>
    </FlexWidget>
  );
};

// ─── Playlist ───────────────────────────────────────────────────────────────

/**
 * 1.41.0: four pinned playlists (Settings → Navigation and shortcuts → Widget playlists). A tap on a tile plays that
 * playlist straight away, from songs on this phone, without opening the app; the header shows what is playing with
 * play/pause. Until some are pinned, the first four playlists stand in.
 */
export const PlaylistWidget: React.FC<{ snapshot: WidgetSnapshot; width: number; height?: number }> = ({ snapshot, width, height = 240 }) => {
  const pins = snapshot.pinned ?? [];
  const shell = {
    width: 'match_parent' as const,
    height: 'match_parent' as const,
    borderRadius: 28,
    backgroundGradient: { from: 'rgba(23, 25, 30, 0.97)' as ColorProp, to: 'rgba(11, 13, 16, 0.97)' as ColorProp, orientation: 'TOP_BOTTOM' as const },
    padding: 12,
    flexDirection: 'column' as const,
  };

  if (pins.length === 0) {
    return (
      <FlexWidget clickAction="OPEN_APP" style={{ ...shell, justifyContent: 'center', alignItems: 'center' }}>
        <SvgWidget svg={Icon.note(WAVE)} style={{ width: 28, height: 28 }} />
        <TextWidget text="No playlists yet" style={{ fontSize: 15, fontWeight: '600', color: INK, marginTop: 8 }} />
        <TextWidget text="Make one in LuvLyrics" style={{ fontSize: 12, color: INK_MUTED, marginTop: 2 }} />
      </FlexWidget>
    );
  }

  const gap = 8;
  const header = 44;
  const footer = snapshot.notice || !snapshot.pinnedChosen ? 18 : 0;
  const cols = 2;
  const rows = pins.length > 2 ? 2 : 1;
  const tileW = Math.max(64, Math.floor((width - 24 - gap * (cols - 1)) / cols));
  const tileH = Math.max(56, Math.floor((height - 24 - header - footer - gap * rows) / rows));
  const song = snapshot.song;

  const tile = (pin: WidgetPin) => (
    <FlexWidget
      key={pin.id}
      clickAction="PLAY_PLAYLIST"
      clickActionData={{ playlistId: pin.id, name: pin.name }}
      accessibilityLabel={`Play ${pin.name}`}
      style={{ width: tileW, height: tileH, borderRadius: 16, backgroundColor: 'rgba(255, 255, 255, 0.08)' }}
    >
      <OverlapWidget style={{ width: tileW, height: tileH }}>
        {pin.cover ? <ImageWidget image={asImage(pin.cover)} imageWidth={tileW} imageHeight={tileH} radius={16} /> : <Cover size={Math.min(tileW, tileH)} radius={16} />}
        <FlexWidget style={{
          width: tileW, height: tileH, borderRadius: 16, flexDirection: 'column', justifyContent: 'flex-end', padding: 8,
          backgroundGradient: { from: 'rgba(0, 0, 0, 0)', to: 'rgba(0, 0, 0, 0.72)', orientation: 'TOP_BOTTOM' },
        }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', width: tileW - 16 }}>
            <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
              <TextWidget text={pin.name} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: '700', color: INK }} />
              <TextWidget text={`${pin.songCount} ${pin.songCount === 1 ? 'song' : 'songs'}`} maxLines={1} style={{ fontSize: 11, color: INK_MUTED }} />
            </FlexWidget>
            <FlexWidget style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: WAVE, justifyContent: 'center', alignItems: 'center' }}>
              <SvgWidget svg={Icon.play('#0B0D10')} style={{ width: 13, height: 13 }} />
            </FlexWidget>
          </FlexWidget>
        </FlexWidget>
      </OverlapWidget>
    </FlexWidget>
  );

  return (
    <FlexWidget style={shell}>
      <FlexWidget style={{ width: 'match_parent', height: header, flexDirection: 'row', alignItems: 'center' }}>
        <FlexWidget clickAction="OPEN_URI" clickActionData={{ uri: widgetLink.nowPlaying() }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
          {song ? <Cover uri={song.cover} size={34} radius={6} /> : <SvgWidget svg={Icon.note(WAVE)} style={{ width: 22, height: 22 }} />}
          <FlexWidget style={{ flex: 1, flexDirection: 'column', marginLeft: 8 }}>
            <TextWidget text={song ? song.title : 'LuvLyrics'} maxLines={1} truncate="END" style={{ fontSize: 14, fontWeight: '700', color: INK }} />
            <TextWidget text={song ? song.artist || 'Unknown artist' : 'Tap a playlist to play it'} maxLines={1} truncate="END" style={{ fontSize: 11, color: INK_MUTED }} />
          </FlexWidget>
        </FlexWidget>
        {song ? <RoundButton size={36} iconSize={18} icon={snapshot.isPlaying ? Icon.pause(INK) : Icon.play(INK)} action="TOGGLE_PLAY" label={snapshot.isPlaying ? 'Pause' : 'Play'} fill={GLASS_LIGHT} /> : null}
      </FlexWidget>
      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', marginTop: gap }}>
        {pins.slice(0, 2).map(tile)}
      </FlexWidget>
      {rows > 1 ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', justifyContent: 'space-between', marginTop: gap }}>
          {pins.slice(2, 4).map(tile)}
        </FlexWidget>
      ) : null}
      {footer ? (
        <TextWidget text={snapshot.notice ?? 'Pin playlists in Settings → Navigation and shortcuts'} maxLines={1} truncate="END"
          style={{ fontSize: 11, color: INK_MUTED, marginTop: 4 }} />
      ) : null}
    </FlexWidget>
  );
};
