/**
 * "Updates" in About, laid out like Echo Music's update screen: a status card (up to date, update
 * available, could not check) with the version and when it last looked, then for a newer build its
 * date, size and what changed, a progress bar while it downloads, and one button that goes
 * Update → Downloading → Install. WorkManager owns the transfer; this view only observes it while it
 * is visible and the app is in front.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import appConfig from '../../../app.json';
import { Motion, Radius, Signal, Surface, TypeScale } from '../../constants/allegraTheme';
import {
  checkedAgo, formatSize, INSTALLED_BUILD,
  latestReleaseNotes, LATEST_APK_URL,
  LatestBuild,
  releasedAgo,
  ReleaseNotes,
  RELEASES_URL, standingOf,
} from '../../services/appUpdate';
import { canInstallUpdate, DownloadStatus, downloadUpdate, installUpdate, supportsAppUpdates, updateDownloadStatus } from '../../services/appUpdateDownload';
import { checkNow } from '../../services/updateCheck';
import { useUpdateStore } from '../../store/updateStore';
import * as Haptics from '../../utils/haptics';
import { Tactile } from '../allegra/motion';
import { Switch } from '../settings/SettingsKit';

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
    {!notes.description && notes.sections.length === 0 ? <Text style={styles.body}>No release notes are available for this build.</Text> : null}
  </View>
);

/** WorkManager owns the transfer. This view observes only while visible and active. */
export default function UpdatePanel({ visible, dropdown = false, onClose }: { visible: boolean; dropdown?: boolean; onClose?: () => void }) {
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
        if (alive) setNotice('Could not read the download. Close Updates and try again.');
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
    try {
      const latest = await checkNow();
      setBuild(latest);
      setChecked(true);
      if (!latest) setNotice('Could not load the latest release. Check your connection and retry.');
    } catch {
      setBuild(null);
      setChecked(true);
      setNotice('Could not reach the release feed. Check your connection and retry.');
    }
    finally { checkBusy.current = false; setChecking(false); }
  }, []);

  // The app-wide watcher (services/updateWatcher) looks more often while this panel is open, and when it finds a new
  // build the store changes: refresh what this panel shows, so an update that lands now appears without a tap.
  const availableCommit = useUpdateStore(s => s.available?.commit ?? null);
  useEffect(() => {
    if (!visible) return undefined;
    import('../../services/updateWatcher').then(m => m.setUpdateWatchFast(true)).catch(() => {});
    return () => { import('../../services/updateWatcher').then(m => m.setUpdateWatchFast(false)).catch(() => {}); };
  }, [visible]);
  useEffect(() => {
    if (visible && checked && availableCommit) check().catch(() => {});
    // Only a changed commit refreshes; check() itself rewrites the store with the same commit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableCommit]);

  // Opening the updates dropdown always checks so the installed and latest versions and notes are real.
  // About continues to respect the listener's automatic-check preference.
  useEffect(() => {
    if (visible && (dropdown || autoCheck) && !checked) check().catch(() => {});
  }, [visible, dropdown, autoCheck, checked, check]);

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
  const latestNotes = latestReleaseNotes(build);
  const latestVersion = build?.version ?? (checking ? 'Checking' : checked ? 'Unavailable' : 'Not checked');

  const head: { icon: IconName; tone: 'wave' | 'ok' | 'warn' | 'plain'; title: string; sub: string } =
    checking ? { icon: 'sync', tone: 'plain', title: 'Checking for updates', sub: `You are on ${installedLabel}` }
    : downloading ? { icon: 'cloud-download-outline', tone: 'wave', title: `Downloading update · ${status.progress}%`, sub: 'You can keep listening or leave the app.' }
    : ready ? { icon: 'phone-portrait-outline', tone: 'wave', title: 'Ready to install', sub: 'Android will ask you to confirm. Your library stays.' }
    : available ? { icon: 'arrow-down-circle', tone: 'wave', title: build?.version ? `Update available · ${build.version}` : 'Update available', sub: `Released ${releasedAgo(build.publishedAt)}${build.sizeBytes ? ` · ${formatSize(build.sizeBytes)}` : ''}` }
    : build && standing === 'current' ? { icon: 'checkmark-circle', tone: 'ok', title: "You're on the latest version", sub: `Version ${installedLabel}` }
    : build && standing === 'older' ? { icon: 'checkmark-circle', tone: 'ok', title: 'This phone is ahead of the release', sub: `Version ${installedLabel}. The latest release came out ${releasedAgo(build.publishedAt)}.` }
    : checked ? { icon: 'alert-circle', tone: 'warn', title: "Couldn't check for updates", sub: 'The update server did not answer. Try again in a minute.' }
    : { icon: 'refresh-circle', tone: 'plain', title: 'Check for updates', sub: `You are on ${installedLabel}` };

  const busy = checking || installing;
  const action: { label: string; icon: IconName; run: () => void } | null =
    !supportsAppUpdates ? null
    : ready ? { label: 'Install update', icon: 'phone-portrait-outline', run: () => { install().catch(() => {}); } }
    : downloading ? null
    : canDownload ? { label: status.kind === 'error' ? 'Retry download' : 'Update', icon: 'arrow-down', run: () => { download().catch(() => {}); } }
    : { label: checked && !build ? 'Retry' : checked ? 'Check again' : 'Check for updates', icon: 'refresh', run: () => { check().catch(() => {}); } };

  return <>
    <View style={styles.titleRow}>
      <Text style={styles.title}>Updates</Text>
      {onClose ? (
        <Tactile onPress={onClose} accessibilityRole="button" accessibilityLabel="Close updates" hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={20} color={Signal.ink} />
        </Tactile>
      ) : null}
    </View>

    {dropdown ? (
      <View style={styles.versions} accessibilityLabel={`Current version ${appConfig.expo.version}. Latest version ${latestVersion}.`}>
        <View style={styles.versionLine}><Text style={styles.versionLabel}>Current</Text><Text style={styles.versionValue}>{appConfig.expo.version}</Text></View>
        <View style={styles.versionLine}><Text style={styles.versionLabel}>Latest</Text><Text style={styles.versionValue}>{latestVersion}</Text></View>
      </View>
    ) : null}

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

    {latestNotes ? <Notes notes={latestNotes} /> : null}
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

    {!dropdown ? <>
      <View style={styles.settings}>
        <Switch
          label="Check for updates automatically"
          hint="Looks when you open the app, at most every few hours."
          value={autoCheck}
          onChange={on => useUpdateStore.getState().setAutoCheck(on)}
        />
      </View>

      <View style={styles.links}>
        <Text style={styles.link} accessibilityRole="link" onPress={() => { Linking.openURL(RELEASES_URL).catch(() => setNotice('Could not open the release notes.')); }}>Release notes ↗</Text>
      </View>
    </> : null}
  </>;
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: Signal.ink, fontSize: 17, fontWeight: '700' },
  close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: Surface.control },
  versions: { gap: 8, marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: Surface.raised },
  versionLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  versionLabel: { color: Signal.inkMuted, fontSize: TypeScale.meta },
  versionValue: { color: Signal.ink, fontSize: TypeScale.body, fontWeight: '600' },
  body: { color: Signal.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 10 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  tile: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.07)' },
  tileWave: { backgroundColor: Surface.control },
  tileOk: { backgroundColor: Surface.control },
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
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, paddingVertical: 12, paddingHorizontal: 20, borderRadius: Radius.control, backgroundColor: Signal.wave, marginTop: 16 },
  buttonWide: { alignSelf: 'stretch' },
  buttonText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  dim: { opacity: 0.7 },
  settings: { marginTop: 14 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 18, marginTop: 6 },
  link: { color: Signal.inkMuted, fontSize: 13, minHeight: 48, paddingVertical: 14 },
});
