/**
 * @fileoverview The Android side of `FolderPort`: the listener's one chosen folder, reached through the
 * `Downloader` native module (android/.../saf/SafLibrary.kt) with the tree permission they granted.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { getNativeModule } from '../nativeModule';
import type { FolderEntry, FolderPort, FolderSongOutcome } from './libraryFolder';

interface FolderNative {
  exportToFolder(
    treeUri: string,
    path: string[],
    name: string,
    mime: string,
    sourceUri: string | null,
    text: string | null,
  ): Promise<string>;
  exportSong(treeUri: string, song: string): Promise<FolderSongOutcome>;
  renameInFolder(treeUri: string, path: string[], from: string, to: string): Promise<boolean>;
  listFolder(treeUri: string, path: string[]): Promise<FolderEntry[]>;
  folderWritable(treeUri: string): boolean;
}

const native = (): FolderNative | null => (Platform.OS === 'android' ? getNativeModule<FolderNative>('Downloader') : null);

/** Whether this build can keep a downloads folder at all (Android with the native module). */
export const folderSupported = (): boolean => native() !== null && typeof native()?.exportSong === 'function';

/** Whether the app still holds the folder's permission; false after an uninstall or when the listener removed it. */
export function folderStillGranted(treeUri: string): boolean {
  try {
    return native()?.folderWritable(treeUri) ?? false;
  } catch {
    return false;
  }
}

export function nativeFolderPort(treeUri: string): FolderPort {
  const module = native();
  if (!module) throw new Error('A downloads folder needs the Android app.');
  return {
    list: async path => {
      const entries = await module.listFolder(treeUri, path);
      return entries.map(entry => ({ name: entry.name, uri: entry.uri, isDirectory: entry.isDirectory === true }));
    },
    readText: uri => FileSystem.readAsStringAsync(uri),
    write: (path, name, mime, source) =>
      module.exportToFolder(treeUri, path, name, mime, 'uri' in source ? source.uri : null, 'text' in source ? source.text : null),
    exportSong: async song => {
      const outcome = await module.exportSong(treeUri, JSON.stringify(song));
      return { base: outcome.base, audioName: outcome.audioName, audioUri: outcome.audioUri, coverName: outcome.coverName ?? null };
    },
    rename: (path, from, to) => module.renameInFolder(treeUri, path, from, to),
  };
}

/** Opens Android's folder picker. Resolves to the chosen folder's tree uri (the permission is kept), or null when cancelled. */
export async function pickDownloadsFolder(): Promise<string | null> {
  const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  return result.granted ? result.directoryUri : null;
}
