import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { shellHeight } from '../navigation/v6Shell';
import { useConnect } from '../services/connect/ConnectProvider';
import { usePlayerStore } from '../store/playerStore';

/** Whether the mini player is drawn above the tab bar: a song here or on another device, and nothing hiding it. */
export const useMiniPlayerShowing = (): boolean => {
  const localSong = usePlayerStore(s => s.currentSong != null);
  const hidden = usePlayerStore(s => s.hideMiniPlayer);
  const connect = useConnect();
  return !hidden && (localSong || !!(connect.remotePlayback && connect.view?.song));
};

/**
 * Bottom padding a scrolling screen needs so its last row clears the floating
 * chrome: the tab bar, plus the mini player pill while a song is loaded.
 * `extra` adds breathing room below the last item.
 */
export const useBottomClearance = (extra = 24): number => {
  const insets = useSafeAreaInsets();
  const { height, fontScale } = useWindowDimensions();
  const hasSong = useMiniPlayerShowing();
  return shellHeight(height, insets.bottom, hasSong, fontScale) + extra;
};
