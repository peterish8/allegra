import React, { useEffect, useState } from 'react';
import { AppState, LayoutChangeEvent, Platform, StyleSheet } from 'react-native';
import Slider from '@react-native-community/slider';
import { Action, Choice, Row, Section, Switch } from './SettingsKit';
import { Signal } from '../../constants/allegraTheme';
import {
  ISLAND_DISCLOSURE, ISLAND_HEIGHT_RANGE, ISLAND_STYLES, ISLAND_WIDTH_RANGE, IslandStyle, islandSetupStep, islandSummary,
} from '../../services/dynamicIslandSetup';
import {
  openIslandAccessibilitySettings, openIslandAppInfo, readIslandStatus,
  setIslandAllowOnNativeIsland, setIslandEnabled, setIslandHideInApp, setIslandShowLyricStrip, setIslandShowOnLockScreen,
  setIslandShowWhenIdle, setIslandSize, setIslandStyle, openTakeOverSettings, readTakeOverStatus, setTakeOverEnabled,
} from '../../services/NativeDynamicIsland';

/** Said before the listener is sent to Android's notification access page. */
const TAKE_OVER_DISCLOSURE = 'Lets LuvLyrics see which song another app is playing. It reads no notifications.';

export default function DynamicIslandSettings({ onLayout, onNotice }: {
  onLayout?: (event: LayoutChangeEvent) => void;
  onNotice: (message: string) => void;
}) {
  const [status, setStatus] = useState(() => Platform.OS === 'android' ? readIslandStatus() : null);
  const [takeOver, setTakeOver] = useState(() => Platform.OS === 'android' ? readTakeOverStatus() : null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      setStatus(readIslandStatus());
      // Back from Android's notification access page: the listener may have been switched on.
      setTakeOver(readTakeOverStatus());
    });
    return () => subscription.remove();
  }, []);
  if (Platform.OS !== 'android' || !status) return null;

  const change = (save: () => boolean) => {
    if (!save()) onNotice('Could not change the island setting. Try again.');
    setStatus(readIslandStatus());
    setTakeOver(readTakeOverStatus());
  };
  const open = (launch: () => boolean, where = 'Accessibility → Installed apps → LuvLyrics island') => {
    if (!launch()) onNotice(`Could not open Android settings. Open Settings → ${where}.`);
  };
  const openNotificationAccess = () => open(openTakeOverSettings, 'Notifications → Device & app notifications → LuvLyrics');
  const step = islandSetupStep(status);
  return (
    <Section id="island" icon="phone-portrait-outline" title="Dynamic island"
      lead="Your song round the camera, over every app." summary={islandSummary(step)} onLayout={onLayout}>
      {status.nativeIsland ? <>
        <Row label={`Your phone has ${status.nativeIsland}`} hint="The LuvLyrics island stays off unless you choose to use it anyway." />
        <Switch label="Use the LuvLyrics island anyway" value={status.allowOnNativeIsland}
          onChange={on => change(() => setIslandAllowOnNativeIsland(on))} />
      </> : null}
      <Switch label="Show the island" value={status.enabled} onChange={on => change(() => setIslandEnabled(on))} />
      {step === 'needs-service' ? <>
        <Action label="Turn it on in Android settings"
          hint={`${ISLAND_DISCLOSURE} Open LuvLyrics island under Installed apps and switch it on.`}
          onPress={() => open(openIslandAccessibilitySettings)} />
        {status.restrictedSettings ? <Action label="Allow restricted settings"
          hint="If Android blocks the switch, open App info, tap the three-dot menu, then Allow restricted settings."
          onPress={() => open(openIslandAppInfo)} /> : null}
      </> : null}
      <Choice<IslandStyle> label="Shape"
        hint={status.style === 'notch' ? 'Hangs from the top edge of the screen.' : 'Floats just below the top edge.'}
        value={status.style} options={ISLAND_STYLES} onChange={style => change(() => setIslandStyle(style))} />
      <SizeRow label="Width" hint="How wide the closed island is. Open, it always takes the full width." value={status.widthPercent}
        range={ISLAND_WIDTH_RANGE} onChange={w => change(() => setIslandSize(w, status.heightPercent))} />
      <SizeRow label="Height" hint="How tall the pill is, and how far full lyrics and lists open." value={status.heightPercent}
        range={ISLAND_HEIGHT_RANGE} onChange={h => change(() => setIslandSize(status.widthPercent, h))} />
      <Switch label="Show when nothing is playing" value={status.showWhenIdle}
        onChange={on => change(() => setIslandShowWhenIdle(on))} />
      <Switch label="Two lines of lyrics on the card" hint="Pull the open island down for all the lyrics either way."
        value={status.showLyricStrip} onChange={on => change(() => setIslandShowLyricStrip(on))} />
      <Switch label="Show on the lock screen"
        hint="Play, pause, skip and read the lyrics without unlocking. Your playlists, downloads and search open once the phone is unlocked."
        value={status.showOnLockScreen}
        onChange={on => {
          change(() => setIslandShowOnLockScreen(on));
          // The island needs its accessibility switch on to draw anywhere, the lock screen included.
          if (on && !status.serviceEnabled) {
            onNotice(ISLAND_DISCLOSURE);
            open(openIslandAccessibilitySettings);
          }
        }} />
      <Switch label="Hide while LuvLyrics is open" value={status.hideInApp}
        onChange={on => change(() => setIslandHideInApp(on))} />
      {takeOver ? <>
        <Switch label="Play here from other apps"
          hint="When Spotify, YouTube Music or YouTube plays, the island offers to play the same song here, from the same moment."
          value={takeOver.enabled}
          onChange={on => {
            change(() => setTakeOverEnabled(on));
            if (on && !takeOver.listenerEnabled) {
              onNotice(TAKE_OVER_DISCLOSURE);
              openNotificationAccess();
            }
          }} />
        {takeOver.enabled && !takeOver.listenerEnabled ? <>
          <Action label="Allow notification access"
            hint={`${TAKE_OVER_DISCLOSURE} Open LuvLyrics under Notification access and switch it on.`}
            onPress={openNotificationAccess} />
          {status.restrictedSettings ? <Action label="Allow restricted settings"
            hint="If Android blocks the switch, open App info, tap the three-dot menu, then Allow restricted settings."
            onPress={() => open(openIslandAppInfo)} /> : null}
        </> : null}
      </> : null}
    </Section>
  );
}

/** A size slider: the readout follows the thumb, the island resizes on release (it is live on screen). */
function SizeRow({ label, hint, value, range, onChange }: {
  label: string;
  hint: string;
  value: number;
  range: { readonly min: number; readonly max: number };
  onChange: (percent: number) => void;
}) {
  const [live, setLive] = useState(value);
  useEffect(() => { setLive(value); }, [value]);
  return (
    <Row label={`${label}  ${Math.round(live)}%`} hint={hint} stack>
      <Slider
        style={styles.slider}
        minimumValue={range.min}
        maximumValue={range.max}
        step={5}
        value={value}
        onValueChange={setLive}
        onSlidingComplete={onChange}
        minimumTrackTintColor={Signal.wave}
        maximumTrackTintColor="rgba(244,241,234,0.18)"
        thumbTintColor={Signal.wave}
      />
    </Row>
  );
}

const styles = StyleSheet.create({
  slider: { width: '100%', height: 36, marginTop: 4 },
});
