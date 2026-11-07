/**
 * Scan a LuvLyrics code (1.44.0, owner; Search → camera, like Spotify's scanner). The camera looks through a frame
 * shaped like a code; a still is read every moment (services/share/scanImage → packages/shared/luvCode) until one
 * reads, then the song plays or the playlist opens. "Choose a photo" reads a screenshot or a saved picture instead.
 * The camera is asked for when this opens, and only for this; nothing is saved or uploaded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LuvCodePayload } from '@shared/luvCode';
import { CODE_HEIGHT, CODE_WIDTH } from '@shared/luvCode';
import { readCodeFromPhoto } from '../services/share/scanImage';
import { openShareTarget } from '../services/share/openShare';
import { targetForPayload } from '../services/share/shareService';
import { Button, EmptyState, Glass, GUTTER, Haptics, IconButton, Radius, Signal, Space, Text } from '../ui';
import { safeGoBack } from '../utils/navigationService';

/** A pause between stills, so the camera and the page stay smooth while it looks. */
const SCAN_GAP_MS = 350;

export const ScanCodeScreen: React.FC = () => {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [status, setStatus] = useState('Point at a LuvLyrics code');
  const done = useRef(false);

  const open = useCallback(async (payload: LuvCodePayload) => {
    if (done.current) return;
    done.current = true;
    Haptics.success();
    setStatus(payload.kind === 'playlist' ? 'Opening the playlist…' : 'Playing…');
    safeGoBack(navigation);
    const outcome = await openShareTarget(targetForPayload(payload));
    if (outcome === 'not-found') done.current = false;
  }, [navigation]);

  // Read a still, then another after a short pause, until one reads or the screen goes away.
  useEffect(() => {
    if (!focused || !ready || !permission?.granted) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const look = async () => {
      if (!live || done.current) return;
      try {
        const still = await camera.current?.takePictureAsync({ quality: 0.4, skipProcessing: true, shutterSound: false });
        const found = still?.uri ? await readCodeFromPhoto(still.uri) : null;
        if (found && live) { void open(found); return; }
      } catch {
        // The camera can refuse a still while it refocuses; the next one usually works.
      }
      if (live) timer = setTimeout(() => { void look(); }, SCAN_GAP_MS);
    };
    void look();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [focused, ready, permission?.granted, open]);

  const fromPhoto = async () => {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (picked.canceled || !picked.assets?.[0]?.uri) return;
    setStatus('Reading the photo…');
    const found = await readCodeFromPhoto(picked.assets[0].uri);
    if (found) void open(found);
    else { Haptics.refuse(); setStatus('No LuvLyrics code in that photo. Try one with the whole code in it.'); }
  };

  const frameWidth = Math.min(width - GUTTER * 2, 420);
  const frameHeight = (frameWidth * CODE_HEIGHT) / CODE_WIDTH;

  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={[styles.container, styles.centre, { paddingTop: insets.top }]}>
        <EmptyState icon="camera-outline" title="Scan LuvLyrics codes"
          body="Allow the camera to read a code on another phone or a poster. Nothing is recorded or saved."
          action={{ label: permission.canAskAgain ? 'Allow camera' : 'Open settings', onPress: () => { void requestPermission(); } }} />
        <Button label="Choose a photo instead" icon="image-outline" onPress={() => { void fromPhoto(); }} />
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
        <View style={[styles.frame, { width: frameWidth, height: frameHeight }]} />
        <Text variant="label" align="center" style={styles.status} accessibilityLiveRegion="polite">{status}</Text>
      </View>
      <View style={[styles.top, { paddingTop: insets.top }]}>
        <IconButton icon="close" label="Close" variant="secondary" shape="disc" onPress={() => safeGoBack(navigation)} />
        <IconButton icon={torch ? 'flashlight' : 'flashlight-outline'} label={torch ? 'Turn the light off' : 'Turn the light on'}
          variant="secondary" shape="disc" selected={torch} onPress={() => setTorch(!torch)} />
      </View>
      <View style={[styles.bottom, { paddingBottom: insets.bottom + Space.lg }]}>
        <Button label="Choose a photo" icon="image-outline" onPress={() => { void fromPhoto(); }} />
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Signal.bgDeep },
  centre: { alignItems: 'center', justifyContent: 'center', gap: Space.md },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: Space.xs },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center' },
  frame: { borderRadius: Radius.well, borderWidth: 2, borderColor: Glass.focusRing },
  status: { paddingHorizontal: GUTTER, paddingVertical: Space.xs, borderRadius: Radius.pill, backgroundColor: Glass.scrim, overflow: 'hidden' },
});

export default ScanCodeScreen;
