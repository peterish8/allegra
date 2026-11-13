/**
 * Scan a LuvLyrics code (1.44.0, owner; Search → camera, like Spotify's scanner). The camera looks through a frame
 * shaped like a code; a still is read every moment (services/share/scanImage → packages/shared/luvCode) until one
 * reads. Then the frame locks on, LuvLyrics is asked what the code is, and a card shows it with Save and Open
 * (1.57.0, owner: instant result, save, and a designed sequence). "Choose a photo" reads a screenshot instead.
 * The camera is asked for when this opens, and only for this; nothing is saved or uploaded by scanning.
 */
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { Linking, StyleSheet, useWindowDimensions, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LuvCodePayload } from '@shared/luvCode';
import { CODE_HEIGHT, CODE_WIDTH } from '@shared/luvCode';
import { PHOTO_SIDES, readCodeFromPhoto, SCAN_BUDGET_MS } from '../services/share/scanImage';
import { openShareTarget, playResolvedSong } from '../services/share/openShare';
import { SCAN_START, isLooking, scanReducer, scanStatus } from '../services/share/scanFlow';
import { resolveScanned, type ScanResult } from '../services/share/scanResolve';
import { saveSharedPlaylist } from '../services/share/shareService';
import { StreamService } from '../services/stream/StreamService';
import { ScanFrame } from '../components/share/ScanFrame';
import { ScanResultCard, type SaveState } from '../components/share/ScanResultCard';
import { Motion } from '../constants/allegraTheme';
import { Button, EmptyState, GUTTER, Haptics, IconButton, Glass, Radius, Signal, Space, Text } from '../ui';
import { safeGoBack } from '../utils/navigationService';

/** A pause between stills, so the camera and the page stay smooth while it looks. */
const SCAN_GAP_MS = 350;
/** A dead code is said for this long before the scanner looks again. */
const REARM_MS = 2500;

export const ScanCodeScreen: React.FC = () => {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [scan, dispatch] = useReducer(scanReducer, SCAN_START);
  const [kind, setKind] = useState<LuvCodePayload['kind']>();
  const [result, setResult] = useState<ScanResult | null>(null);
  const [save, setSave] = useState<SaveState>('idle');
  const [cameraNote, setCameraNote] = useState('');
  const [photoNote, setPhotoNote] = useState('');
  const busy = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = (fn: () => void, ms: number) => { timers.current.push(setTimeout(fn, ms)); };
  // Pauses must not outlive the screen.
  useEffect(() => () => { timers.current.forEach(clearTimeout); }, []);

  const again = useCallback(() => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    busy.current = false;
    setResult(null);
    setSave('idle');
    setKind(undefined);
    dispatch({ type: 'reset' });
  }, []);

  const onCode = useCallback(async (payload: LuvCodePayload) => {
    if (busy.current) return;
    busy.current = true;
    setKind(payload.kind);
    Haptics.tap();
    dispatch({ type: 'found' });
    // The frame is seen to lock for a beat; the lookup runs meanwhile, so an answer is never held back by the beat.
    const beat = setTimeout(() => dispatch({ type: 'lookup' }), Motion.duration.base);
    timers.current.push(beat);
    const outcome = await resolveScanned(payload);
    clearTimeout(beat);
    if ('result' in outcome) {
      Haptics.success();
      setResult(outcome.result);
      dispatch({ type: 'resolved' });
      return;
    }
    Haptics.refuse();
    dispatch({ type: 'failed', failure: outcome.failure });
    // Let the same code be read again after a pause, so the message stays up long enough to read.
    later(again, REARM_MS);
  }, [again]);

  // Read a still, then another after a short pause, until one reads or the screen goes away.
  const looking = isLooking(scan);
  useEffect(() => {
    if (!focused || !ready || !permission?.granted || !looking) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let refused = 0;
    const look = async () => {
      if (!live || busy.current) return;
      try {
        const still = await camera.current?.takePictureAsync({ quality: 0.55, skipProcessing: true, shutterSound: false });
        refused = 0;
        setCameraNote('');
        const found = still?.uri ? await readCodeFromPhoto(still.uri, SCAN_BUDGET_MS) : null;
        if (found && live) { void onCode(found); return; }
      } catch {
        // The camera can refuse a still while it refocuses; the next one usually works. Said aloud only if it keeps
        // refusing, so a dead camera does not look like a scanner that cannot see.
        if (++refused === 6 && live) setCameraNote('The camera is not giving pictures. Try Choose a photo.');
      }
      if (live) timer = setTimeout(() => { void look(); }, SCAN_GAP_MS);
    };
    void look();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [focused, ready, permission?.granted, looking, onCode]);

  const fromPhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    setPhotoNote('Reading the photo…');
    const found = await readCodeFromPhoto(picked.assets[0].uri, undefined, PHOTO_SIDES);
    if (found) { setPhotoNote(''); void onCode(found); }
    else { Haptics.refuse(); setPhotoNote('No LuvLyrics code in that photo. Try one with the whole code in it.'); }
  };

  const open = () => {
    if (!result) return;
    safeGoBack(navigation);
    if (result.kind === 'song') playResolvedSong(result.song);
    else void openShareTarget({ kind: 'playlist', code: result.code });
  };
  const saveResult = () => {
    if (!result) return;
    setSave('saving');
    if (result.kind === 'playlist') { void saveSharedPlaylist(result.code).then(setSave); return; }
    setSave(StreamService.save(result.song) ? 'saved' : 'failed');
  };

  const frameWidth = Math.min(width - GUTTER * 2, 420);
  const frameHeight = (frameWidth * CODE_HEIGHT) / CODE_WIDTH;
  const status = scan.phase === 'scanning' ? (photoNote || cameraNote || scanStatus(scan)) : scanStatus(scan, kind);
  const showCard = scan.phase === 'resolving' || scan.phase === 'result' || (scan.phase === 'locked' && !!result);

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centre, { paddingTop: insets.top }]}>
        <EmptyState icon="camera-outline" title="Scan LuvLyrics codes"
          body="Allow the camera to read a code on another phone or a poster. Nothing is recorded or saved."
          action={{ label: permission.canAskAgain ? 'Allow camera' : 'Open settings', onPress: () => { if (permission.canAskAgain) void requestPermission(); else void Linking.openSettings(); } }} />
        <Button label="Choose a photo instead" icon="image-outline" onPress={() => { void fromPhoto(); }} />
        {photoNote ? <Text variant="label" align="center">{photoNote}</Text> : null}
        <View style={[styles.top, { paddingTop: insets.top }]}>
          <IconButton icon="close" label="Close" variant="secondary" shape="disc" onPress={() => safeGoBack(navigation)} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {focused ? (
        <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} animateShutter={false}
          onCameraReady={() => setReady(true)} />
      ) : null}
      <View style={[styles.centre, StyleSheet.absoluteFill]} pointerEvents="none">
        <ScanFrame phase={scan.phase} width={frameWidth} height={frameHeight} />
        {status ? <Text variant="label" align="center" style={styles.status} accessibilityLiveRegion="polite">{status}</Text> : null}
      </View>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <IconButton icon="close" label="Close" variant="secondary" shape="disc" onPress={() => safeGoBack(navigation)} />
        <IconButton icon={torch ? 'flashlight' : 'flashlight-outline'} label={torch ? 'Turn the light off' : 'Turn the light on'}
          variant="secondary" shape="disc" selected={torch} onPress={() => setTorch(!torch)} />
      </View>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + Space.lg }]}>
        {showCard ? (
          <ScanResultCard result={result} save={save} onSave={saveResult} onOpen={open} onAgain={again} />
        ) : (
          <View style={styles.photo}><Button label="Choose a photo" icon="image-outline" onPress={() => { void fromPhoto(); }} /></View>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Signal.bgDeep },
  centre: { alignItems: 'center', justifyContent: 'center', gap: Space.md },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space.xs },
  photo: { alignItems: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'stretch' },
  status: { paddingHorizontal: GUTTER, paddingVertical: Space.xs, borderRadius: Radius.pill, backgroundColor: Glass.scrim, overflow: 'hidden' },
});

export default ScanCodeScreen;
