import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

export type DownloadStatus = { kind: 'idle' | 'downloading' | 'ready' | 'error'; progress: number; message: string };
interface AppUpdater {
  download(url: string): Promise<void>;
  status(): Promise<DownloadStatus>;
  canInstall(): boolean;
  install(): Promise<'permission' | 'installer'>;
}
const native = Platform.OS === 'android' ? requireOptionalNativeModule<AppUpdater>('AppUpdater') : null;
export const supportsAppUpdates = !!native;
export const downloadUpdate = async (url: string): Promise<void> => {
  if (!native) throw new Error('App updates need an Android build of LuvLyrics.');
  await native.download(url);
};
export const updateDownloadStatus = async (): Promise<DownloadStatus> =>
  native ? native.status() : { kind: 'idle', progress: 0, message: '' };
export const canInstallUpdate = (): boolean => native?.canInstall() ?? false;
export const installUpdate = async (): Promise<'permission' | 'installer'> => {
  if (!native) throw new Error('App updates need an Android build of LuvLyrics.');
  return native.install();
};
