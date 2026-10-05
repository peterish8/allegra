/**
 * What each page's "i" walks through (components/InfoTour). Only what the page really does: a step
 * that names a control must match that control.
 */
import { Clock3, Compass, FileUp, Heart, History, ImagePlus, Link2, ListChecks, ListMusic, Mic, Music2, Palette, Play, Search, Share2, ShieldCheck, Shuffle, Smartphone, Type, Users, Waves } from 'lucide-react';

import type { TourStep } from './InfoTour';

export const HOME_TOUR: readonly TourStep[] = [
  { title: 'A song to start with', body: 'Home opens on a pick for right now. Press play, or shuffle for another.', icon: Play, pose: 'lift' },
  { title: 'Jump back in', body: 'The covers beside it bring back what you played last, one tap away.', icon: History, pose: 'fan' },
  { title: 'Your artists', body: 'The artists you play most gather here, learned from your listening.', icon: Users, pose: 'orbit' },
  { title: 'Songs you love', body: 'Every heart you tap shows up here and in Liked Songs.', icon: Heart, pose: 'spread' }
];

export const BROWSE_TOUR: readonly TourStep[] = [
  { title: 'Search anything', body: 'A song, an artist or a mood. Press Ctrl K, or ⌘K on a Mac, from anywhere.', icon: Search, pose: 'lift' },
  { title: 'Quick picks', body: 'Tap a mood pill along the top to fill the page with music for that feeling.', icon: Waves, pose: 'fan' },
  { title: 'Wander further', body: 'Moods, today’s chart and new finds below. Press play on anything to start.', icon: Compass, pose: 'spread' }
];

export const LIBRARY_TOUR: readonly TourStep[] = [
  { title: 'Your likes', body: 'Tap the heart on any track and it lands here, on every device you sign in to.', icon: Heart, pose: 'stack' },
  { title: 'Playlists', body: 'Name one here, then use the list-plus button on any track to add to it.', icon: ListMusic, pose: 'fan' },
  { title: 'Blends', body: 'A playlist shared with friends, made from all your tastes and fresh every day.', icon: Users, pose: 'orbit' },
  { title: 'Played lately', body: 'Your recent listening, ready to pick up where you left off.', icon: Clock3, pose: 'spread' }
];

export const LIKED_TOUR: readonly TourStep[] = [
  { title: 'Everything you love', body: 'Every heart you tap, on any device you sign in to, collects here.', icon: Heart, pose: 'stack' },
  { title: 'Play or shuffle', body: 'Play them in order, or shuffle for a fresh run through.', icon: Shuffle, pose: 'fan' },
  { title: 'Change your mind', body: 'Tap a heart again to take that song out.', icon: Heart, pose: 'lift' }
];

export const PLAYLIST_TOUR: readonly TourStep[] = [
  { title: 'Add songs', body: 'Use the list-plus button on any track to put it in this playlist.', icon: ListMusic, pose: 'stack' },
  { title: 'Give it a cover', body: 'Upload your own image and it becomes the playlist’s cover.', icon: ImagePlus, pose: 'lift' },
  { title: 'Share it', body: 'Make it public to get a link anyone can open.', icon: Share2, pose: 'orbit' },
  { title: 'Play or shuffle', body: 'Start from the top, or shuffle it.', icon: Shuffle, pose: 'fan' }
];

export const IMPORT_TOUR: readonly TourStep[] = [
  { title: 'Connect Spotify', body: 'Transfer your Liked Songs and playlists straight from your Spotify account.', icon: Link2, pose: 'orbit' },
  { title: 'Or use a file', body: 'Spotify’s data export (ZIP or JSON) or any CSV works.', icon: FileUp, pose: 'fan' },
  { title: 'Your file stays here', body: 'It never leaves this device. Only titles, artists, albums and lengths are sent to find the songs.', icon: ShieldCheck, pose: 'lift' },
  { title: 'You choose', body: 'Review the matches before anything is saved to your library.', icon: ListChecks, pose: 'spread' }
];

export const SETTINGS_TOUR: readonly TourStep[] = [
  { title: 'Playback', body: 'Decide what happens after the song you picked.', icon: Music2, pose: 'stack' },
  { title: 'Lyrics', body: 'How lyrics look and keep time.', icon: Type, pose: 'fan' },
  { title: 'Karaoke', body: 'Vocal removal runs on this device. Nothing is uploaded.', icon: Mic, pose: 'lift' },
  { title: 'Appearance', body: 'Pick the moving light behind the app.', icon: Palette, pose: 'spread' },
  { title: 'Account and privacy', body: 'Your privacy choices follow you to every device you sign in to.', icon: ShieldCheck, pose: 'orbit' },
  { title: 'On your phone', body: 'Get the Android app and keep the same account there.', icon: Smartphone, pose: 'stack' }
];

export const BLEND_TOUR: readonly TourStep[] = [
  { title: 'Your taste match', body: 'How much your listening overlaps, worked out from what each of you likes and plays.', icon: Users, pose: 'orbit' },
  { title: 'The story', body: 'Cards for the song that brings you together, who brought what and more. Share any card as an image.', icon: Share2, pose: 'fan' },
  { title: 'Whose pick is it', body: 'Each colour is one of you. Filter the list to hear one person’s picks.', icon: Users, pose: 'spread' },
  { title: 'Fresh every day', body: 'The Blend rebuilds daily, so it moves with what you both play.', icon: Play, pose: 'lift' }
];
