import React, { useEffect, useState } from 'react';
import { AppState, LayoutChangeEvent, Platform } from 'react-native';
import { Action, Row, Section, Switch } from './SettingsKit';
import { ISLAND_DISCLOSURE, islandSetupStep, islandSummary } from '../../services/dynamicIslandSetup';
import {
  openIslandAccessibilitySettings, openIslandAppInfo, readIslandStatus,
  setIslandAllowOnNativeIsland, setIslandEnabled, setIslandHideInApp, setIslandShowLyricStrip, setIslandShowWhenIdle,
} from '../../services/NativeDynamicIsland';

export default function DynamicIslandSettings({ onLayout, onNotice }: {
  onLayout?: (event: LayoutChangeEvent) => void;
  onNotice: (message: string) => void;
}) {
  const [status, setStatus] = useState(() => Platform.OS === 'android' ? readIslandStatus() : null);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') setStatus(readIslandStatus());
    });
    return () => subscription.remove();
  }, []);
  if (Platform.OS !== 'android' || !status) return null;

  const change = (save: () => boolean) => {
    if (!save()) onNotice('Could not change the island setting. Try again.');
    setStatus(readIslandStatus());
  };
  const open = (launch: () => boolean) => {
    if (!launch()) onNotice('Could not open Android settings. Open Settings → Accessibility → Installed apps → LuvLyrics island.');
  };
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
      <Switch label="Show when nothing is playing" value={status.showWhenIdle}
        onChange={on => change(() => setIslandShowWhenIdle(on))} />
      <Switch label="Two lines of lyrics on the card" hint="Pull the open island down for all the lyrics either way."
        value={status.showLyricStrip} onChange={on => change(() => setIslandShowLyricStrip(on))} />
      <Switch label="Hide while LuvLyrics is open" value={status.hideInApp}
        onChange={on => change(() => setIslandHideInApp(on))} />
    </Section>
  );
}
