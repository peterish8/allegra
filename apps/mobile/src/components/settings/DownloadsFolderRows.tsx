import React, { useCallback, useState } from 'react';
import { Action } from './SettingsKit';
import { useSettingsStore } from '../../store/settingsStore';
import {
  chooseDownloadsFolder,
  downloadsFolderStatus,
  folderLabel,
  folderSupported,
  saveToDownloadsFolder,
} from '../../services/folder/downloadsFolder';
import { restoredNotice, savedNotice } from '../../services/folder/folderMessages';

/**
 * Settings rows for the downloads folder: choose it, copy what is missing, stop using it. Rendered inside
 * "Library and data". Nothing shows on a build without the native folder support.
 */
const DownloadsFolderRows: React.FC<{ onNotice: (text: string) => void }> = ({ onNotice }) => {
  const uri = useSettingsStore(s => s.downloadDirectoryUri);
  const setDownloadDirectory = useSettingsStore(s => s.setDownloadDirectory);
  const [working, setWorking] = useState<string | null>(null);

  const choose = useCallback(async () => {
    if (working) return;
    setWorking('Choosing');
    try {
      const result = await chooseDownloadsFolder();
      if (result.chosen) onNotice(restoredNotice(result.restored.songs, result.restored.playlists));
    } catch {
      onNotice('Could not open that folder. Try another one.');
    } finally {
      setWorking(null);
    }
  }, [working, onNotice]);

  const copy = useCallback(async () => {
    if (working || !uri) return;
    setWorking('Copying');
    try {
      const report = await saveToDownloadsFolder(uri, (done, total) => setWorking(`${done}/${total}`));
      onNotice(savedNotice(report.saved + report.playlistCopies, report.failed));
    } catch {
      onNotice('Could not copy to the folder. Check that it is still there.');
    } finally {
      setWorking(null);
    }
  }, [working, uri, onNotice]);

  if (!folderSupported()) return null;
  const status = downloadsFolderStatus();

  if (!uri) {
    return (
      <Action
        label="Downloads folder"
        hint="Keep your songs and playlists in one folder you choose. They stay when you delete the app."
        value={working ?? undefined}
        onPress={choose}
      />
    );
  }
  if (!status.usable) {
    return (
      <Action
        label="Downloads folder"
        hint="Android no longer lets LuvLyrics use this folder. Choose it again to bring your songs back."
        value={working ?? 'Choose again'}
        onPress={choose}
      />
    );
  }
  return (
    <>
      <Action
        label="Downloads folder"
        hint="Every download is copied here, with its cover and lyrics, and each playlist gets its own folder."
        value={working ?? folderLabel(uri)}
        onPress={choose}
      />
      <Action label="Copy my library to the folder" hint="Adds every song and playlist that is not there yet." onPress={copy} />
      <Action
        label="Stop using this folder"
        hint="Your files stay where they are."
        onPress={() => setDownloadDirectory(null)}
      />
    </>
  );
};

export default DownloadsFolderRows;
