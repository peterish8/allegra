import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tactile } from '../allegra/motion';
import { Radius, Signal } from '../../constants/allegraTheme';
import { fetchLatestBuild, INSTALLED_BUILD, LatestBuild, LATEST_APK_URL, releasedAgo, RELEASES_URL, standingOf } from '../../services/appUpdate';
import { canInstallUpdate, downloadUpdate, DownloadStatus, installUpdate, supportsAppUpdates, updateDownloadStatus } from '../../services/appUpdateDownload';
import appConfig from '../../../app.json';

/** WorkManager owns the transfer. This view observes only while visible and active. */
export default function UpdatePanel({ visible }: { visible: boolean }) {
  const [build, setBuild] = useState<LatestBuild | null>(null);
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<DownloadStatus>({ kind: 'idle', progress: 0, message: '' });
  const [notice, setNotice] = useState('');
  const [installing, setInstalling] = useState(false);
  const autoInstall = useRef(false);
  const needsPermission = useRef(false);
  const installBusy = useRef(false);
  const downloadBusy = useRef(false);

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

  const check = async () => {
    setChecking(true);
    setNotice('');
    try { setBuild(await fetchLatestBuild()); setChecked(true); }
    finally { setChecking(false); }
  };
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
  const canDownload = status.kind === 'error' || (checked && (standing === null || standing === 'update'));
  const installedLabel = `${appConfig.expo.version}${INSTALLED_BUILD.commit ? ` (build ${INSTALLED_BUILD.commit.slice(0, 7)})` : ''}`;
  const text = downloading ? `Downloading update · ${status.progress}%`
    : ready ? 'Install update' : canDownload ? 'Download update' : checked ? 'Check again' : 'Check for updates';

  return <>
    <Text style={styles.title}>Updates</Text>
    <Text style={styles.body}>
      {downloading ? 'Your update is downloading here. You can keep listening or leave the app.'
        : ready ? 'The update is ready. Android will ask you to confirm installation. Your library stays.'
          : build && standing === 'current' ? `You're on the latest build, ${installedLabel}.`
            : build && standing === 'older' ? `This phone has a newer build (${installedLabel}) than the latest release, which came out ${releasedAgo(build.publishedAt)}. Nothing to download.`
              : build ? `The latest build came out ${releasedAgo(build.publishedAt)}. Download it here and we will open the installer when it is ready.`
                : checked ? 'Could not check the release. You can retry or download from the latest build link.'
                  : `You are on ${installedLabel}. Check for the latest LuvLyrics build.`}
    </Text>
    {notice || status.kind === 'error' ? <Text style={styles.notice} accessibilityLiveRegion="polite">{notice || status.message}</Text> : null}
    {supportsAppUpdates ? <Tactile
      onPress={ready ? install : canDownload ? download : check}
      disabled={checking || downloading || installing}
      accessibilityRole="button" accessibilityLabel={checking ? 'Checking for updates' : text}
      style={[styles.button, (checking || downloading || installing) && styles.dim]} pressScale={0.95}
    >
      {checking || downloading || installing ? <ActivityIndicator size="small" color={Signal.waveInk} /> : <Ionicons name={ready ? 'phone-portrait-outline' : canDownload ? 'arrow-down' : 'refresh'} size={16} color={Signal.waveInk} />}
      <Text style={styles.buttonText}>{checking ? 'Checking' : text}</Text>
    </Tactile> : <Text style={styles.body}>Installable updates are available in the Android app.</Text>}
    <Text style={styles.link} accessibilityRole="link" onPress={() => { Linking.openURL(RELEASES_URL).catch(() => setNotice('Could not open the release notes.')); }}>Latest release notes ↗</Text>
  </>;
}
const styles = StyleSheet.create({
  title: { color: Signal.ink, fontSize: 17, fontWeight: '700' },
  body: { color: Signal.inkSoft, fontSize: 14, lineHeight: 21, marginTop: 6 },
  notice: { color: Signal.accentBright, fontSize: 13, lineHeight: 19, marginTop: 10 },
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 18, borderRadius: Radius.pill, backgroundColor: Signal.wave, marginTop: 14 },
  buttonText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  dim: { opacity: 0.7 },
  link: { color: Signal.inkMuted, fontSize: 13, marginTop: 14, paddingVertical: 6 },
});
