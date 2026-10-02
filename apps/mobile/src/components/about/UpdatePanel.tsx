/**
 * "Updates" in About, laid out like Echo Music's update screen: a status card (up to date, update
 * available, could not check) with the version and when it last looked, then for a newer build its
 * date, size and what changed, a progress bar while it downloads, and one button that goes
 * Update → Downloading → Install. WorkManager owns the transfer; this view only observes it while it
 * is visible and the app is in front.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Tactile } from '../allegra/motion';
import { Switch } from '../settings/SettingsKit';
import { Motion, Radius, Signal } from '../../constants/allegraTheme';
import {
  ALL_RELEASES_URL, checkedAgo, formatSize, INSTALLED_BUILD, LatestBuild, LATEST_APK_URL, ReleaseNotes, releasedAgo, RELEASES_URL, standingOf,
} from '../../services/appUpdate';
import { canInstallUpdate, downloadUpdate, DownloadStatus, installUpdate, supportsAppUpdates, updateDownloadStatus } from '../../services/appUpdateDownload';
import { checkNow } from '../../services/updateCheck';
import { useUpdateStore } from '../../store/updateStore';
import * as Haptics from '../../utils/haptics';
import appConfig from '../../../app.json';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The download's progress as a bar that grows by scale, never by width. */
const ProgressBar: React.FC<{ percent: number }> = ({ percent }) => {
  const reduce = useReducedMotion();
  const fill = useSharedValue(percent / 100);
  useEffect(() => {
    fill.value = withTiming(percent / 100, { duration: reduce ? 0 : Motion.duration.base, easing: Motion.ease.standard });
  }, [percent, reduce, fill]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: fill.value }] }));
  return (
    <View style={styles.track} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
      <Animated.View style={[styles.fill, style]} />
    </View>
  );
};

/** What changed, as grouped rows: a title, then its items joined into one rounded block. */
const Notes: React.FC<{ notes: ReleaseNotes }> = ({ notes }) => (
  <View>
    {notes.description ? <Text style={styles.body}>{notes.description}</Text> : null}
    {notes.sections.map(section => (
      <View key={section.title}>
        <Text style={styles.sectionTitle}>{section.title}</Text>
        <View style={styles.group}>
          {section.items.map((item, index) => (
            <View key={`${index}-${item}`} style={[styles.item, index > 0 && styles.itemDivider]}>
              <View style={styles.dot} />
              <Text style={styles.itemText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>
    ))}
  </View>
);

/** WorkManager owns the transfer. This view observes only while visible and active. */
export default function UpdatePanel({ visible }: { visible: boolean }) {
  const [build, setBuild] = useState<LatestBuild | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<DownloadStatus>({ kind: 'idle', progress: 0, message: '' });
  const [notice, setNotice] = useState('');
  const [installing, setInstalling] = useState(false);
  const autoCheck = useUpdateStore(s => s.autoCheck);
  const lastCheckedAt = useUpdateStore(s => s.lastCheckedAt);
  const autoInstall = useRef(false);
  const needsPermission = useRef(false);
  const installBusy = useRef(false);
  const downloadBusy = useRef(false);
  const checkBusy = useRef(false);

  const install = useCallback(async () => {
    if (installBusy.current) return;
    installBusy.current = true;
    setInstalling(true);
    try {
      const result = await installUpdate();
      needsPermission.current = result === 'permission';
      setNotice(result === 'permission'
        ? 'Allow LuvLyrics to install updates, then return here.'
        : 'Confirm Install in Android. If you cancel, you can try again here.');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not open the installer. Try again.');
    } finally { installBusy.current = false; setInstalling(false); }
  }, []);

  const downloading = status.kind === 'downloading';
  useEffect(() => {
    if (!visible || !supportsAppUpdates) return;
    let alive = true;
    let active = AppState.currentState === 'active';
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    const poll = async () => {
      if (!alive || !active || polling) return;
      polling = true;
      try {
        const next = await updateDownloadStatus();
        if (!alive || !active) return;
        setStatus(next);
        if (next.kind === 'ready' && autoInstall.current) {
          autoInstall.current = false;
          await install();
        }
        if (next.kind === 'downloading') timer = setTimeout(poll, 700);
      } catch {
        if (alive) setNotice('Could not read the download. Close About and try again.');
      } finally { polling = false; }
    };
    poll().catch(() => {});
    const subscription = AppState.addEventListener('change', state => {
      active = state === 'active';
      if (timer) clearTimeout(timer);
      if (active) {
        if (needsPermission.current && canInstallUpdate()) {
          needsPermission.current = false;
          install().catch(() => {});
        }
        poll().catch(() => {});
      }
    });
    return () => { alive = false; if (timer) clearTimeout(timer); subscription.remove(); };
  }, [visible, install, downloading]);

  const check = useCallback(async () => {
    if (checkBusy.current) return;
    checkBusy.current = true;
    setChecking(true);
    setNotice('');
    try { setBuild(await checkNow()); setChecked(true); }
    finally { checkBusy.current = false; setChecking(false); }
  }, []);

  // Opening About looks for an update by itself, unless the listener turned that off (Echo does the same).
  useEffect(() => {
    if (visible && autoCheck && !checked) check().catch(() => {});
  }, [visible, autoCheck, checked, check]);

  const download = async () => {
    if (downloadBusy.current) return;
    downloadBusy.current = true;
    setNotice('');
    autoInstall.current = true;
    try {
      await downloadUpdate(build?.downloadUrl ?? LATEST_APK_URL);
      setStatus({ kind: 'downloading', progress: 0, message: '' });
    } catch (e) {
      autoInstall.current = false;
      setStatus({ kind: 'error', progress: 0, message: e instanceof Error ? e.message : 'Download failed. Try again.' });
    } finally { downloadBusy.current = false; }
  };

  const ready = status.kind === 'ready';
  // Never offer the release when it is this build or older than it: every build is versionCode 1,
  // so Android would install an older one over this without a word.
  const standing = build ? standingOf(build, INSTALLED_BUILD) : null;
  const available = build !== null && standing === 'update';
  const canDownload = status.kind === 'error' || available;
  const installedLabel = `${appConfig.expo.version}${INSTALLED_BUILD.commit ? ` · build ${INSTALLED_BUILD.commit.slice(0, 7)}` : ''}`;
  const lastChecked = lastCheckedAt ? `Last checked ${checkedAgo(new Date(lastCheckedAt))}` : 'Not checked yet';

  const head: { icon: IconName; tone: 'wave' | 'ok' | 'warn' | 'plain'; title: string; sub: string } =
    checking ? { icon: 'sync', tone: 'plain', title: 'Checking for updates', sub: `You are on ${installedLabel}` }
    : downloading ? { icon: 'cloud-download-outline', tone: 'wave', title: `Downloading update · ${status.progress}%`, sub: 'You can keep listening or leave the app.' }
    : ready ? { icon: 'phone-portrait-outline', tone: 'wave', title: 'Ready to install', sub: 'Android will ask you to confirm. Your library stays.' }
    : available ? { icon: 'arrow-down-circle', tone: 'wave', title: build?.version ? `Update available · ${build.version}` : 'Update available', sub: `Released ${releasedAgo(build.publishedAt)}${build.sizeBytes ? ` · ${formatSize(build.sizeBytes)}` : ''}` }
    : build && standing === 'current' ? { icon: 'checkmark-circle', tone: 'ok', title: "You're on the latest version", sub: `Version ${installedLabel}` }
    : build && standing === 'older' ? { icon: 'checkmark-circle', tone: 'ok', title: 'This phone is ahead of the release', sub: `Version ${installedLabel}. The latest release came out ${releasedAgo(build.publishedAt)}.` }
    : checked ? { icon: 'alert-circle', tone: 'warn', title: "Couldn't check for updates", sub: 'Check your connection and try again.' }
    : { icon: 'refresh-circle', tone: 'plain', title: 'Check for updates', sub: `You are on ${installedLabel}` };

  const busy = checking || installing;
  const action: { label: string; icon: IconName; run: () => void } | null =
    !supportsAppUpdates ? null
    : ready ? { label: 'Install update', icon: 'phone-portrait-outline', run: () => { install().catch(() => {}); } }
    : downloading ? null
    : canDownload ? { label: 'Update', icon: 'arrow-down', run: () => { download().catch(() => {}); } }
    : { label: checked ? 'Check again' : 'Check for updates', icon: 'refresh', run: () => { check().catch(() => {}); } };

  return <>
    <Text style={styles.title}>Updates</Text>

    <View style={styles.card} accessibilityLiveRegion="polite">
      <View style={[styles.tile, head.tone === 'wave' && styles.tileWave, head.tone === 'ok' && styles.tileOk, head.tone === 'warn' && styles.tileWarn]}>
        {checking ? <ActivityIndicator size="small" color={Signal.ink} />
          : <Ionicons name={head.icon} size={22} color={head.tone === 'wave' ? Signal.wave : head.tone === 'warn' ? Signal.accentBright : head.tone === 'ok' ? Signal.wave : Signal.inkSoft} />}
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{head.title}</Text>
        <Text style={styles.cardSub}>{head.sub}</Text>
        {!available && !downloading && !ready ? <Text style={styles.cardMeta}>{lastChecked}</Text> : null}
      </View>
    </View>

    {available && build ? <Notes notes={build.notes} /> : null}
    {downloading ? <ProgressBar percent={status.progress} /> : null}

    {notice || status.kind === 'error' ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice || status.message}</Text> : null}

    {action ? (
      <Tactile
        onPress={() => { Haptics.selectionAsync().catch(() => {}); action.run(); }}
        disabled={busy}
        accessibilityRole="button" accessibilityLabel={checking ? 'Checking for updates' : action.label}
        style={[styles.button, available || ready ? styles.buttonWide : null, busy && styles.dim]} pressScale={0.96}
      >
        {busy ? <ActivityIndicator size="small" color={Signal.waveInk} /> : <Ionicons name={action.icon} size={16} color={Signal.waveInk} />}
        <Text style={styles.buttonText}>{checking ? 'Checking' : action.label}</Text>
      </Tactile>
    ) : !supportsAppUpdates ? <Text style={styles.body}>Installable updates are available in the Android app.</Text> : null}

    <View style={styles.settings}>
      <Switch
        label="Check for updates automatically"
        hint="Looks when you open the app, at most every few hours, and marks About when there is something new."
        value={autoCheck}
        onChange={on => useUpdateStore.getState().setAutoCheck(on)}
      />
    </View>

    <View style={styles.links}>
      <Text style={styles.link} accessibilityRole="link" onPress={() => { Linking.openURL(RELEASES_URL).catch(() => setNotice('Could not open the release notes.')); }}>Latest release notes ↗</Text>
      <Text style={styles.link} accessibilityRole="link" onPress={() => { Linking.openURL(ALL_RELEASES_URL).catch(() => setNotice('Could not open the releases.')); }}>All releases ↗</Text>
    </View>
  </>;
}

const styles = StyleSheet.create({
  title: { color: Signal.ink, fontSize: 17, fontWeight: '700' },
  body: { color: Signal.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  tileWave: { backgroundColor: 'rgba(217, 230, 106, 0.14)' },
  tileOk: { backgroundColor: 'rgba(217, 230, 106, 0.1)' },
  tileWarn: { backgroundColor: 'rgba(238, 107, 95, 0.16)' },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { color: Signal.ink, fontSize: 15, fontWeight: '700' },
  cardSub: { color: Signal.inkSoft, fontSize: 13, lineHeight: 18 },
  cardMeta: { color: Signal.inkMuted, fontSize: 12, marginTop: 2 },
  sectionTitle: { color: Signal.ink, fontSize: 14, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  group: { borderRadius: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingVertical: 11 },
  itemDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.07)' },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, backgroundColor: Signal.wave },
  itemText: { flex: 1, color: Signal.inkSoft, fontSize: 14, lineHeight: 20 },
  track: { height: 8, borderRadius: 4, marginTop: 16, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.1)' },
  // Grows by scale from the left edge: transform only, no layout per frame.
  fill: { height: 8, borderRadius: 4, backgroundColor: Signal.wave, transformOrigin: 'left' },
  notice: { color: Signal.accentBright, fontSize: 13, lineHeight: 19, marginTop: 12 },
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 46, paddingHorizontal: 20, borderRadius: Radius.pill, backgroundColor: Signal.wave, marginTop: 16 },
  buttonWide: { alignSelf: 'stretch' },
  buttonText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  dim: { opacity: 0.7 },
  settings: { marginTop: 14 },
  links: { flexDirection: 'row', gap: 18, marginTop: 6 },
  link: { color: Signal.inkMuted, fontSize: 13, paddingVertical: 8 },
});
