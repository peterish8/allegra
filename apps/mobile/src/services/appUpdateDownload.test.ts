const mockUpdater = {
  download: jest.fn(async (_url: string) => undefined),
  status: jest.fn(async () => ({ kind: 'downloading', progress: 35, message: '' })),
  canInstall: jest.fn(() => true),
  install: jest.fn(async () => 'installer'),
};
jest.mock('expo', () => ({ requireOptionalNativeModule: () => mockUpdater }));
jest.mock('react-native', () => ({ Platform: { OS: 'android' } }));
import { downloadUpdate, updateDownloadStatus, canInstallUpdate, installUpdate } from './appUpdateDownload';
import { LATEST_APK_URL, RELEASES_URL } from './appUpdate';

beforeEach(() => jest.clearAllMocks());
it('downloads the latest APK from the owner fork through the native worker', async () => {
  expect(LATEST_APK_URL).toBe('https://github.com/peterish8/allegra/releases/download/apk-latest/LuvLyrics.apk');
  expect(RELEASES_URL).toContain('peterish8/allegra');
  await downloadUpdate(LATEST_APK_URL);
  expect(mockUpdater.download).toHaveBeenCalledWith(LATEST_APK_URL);
});
it('reads persisted background download progress', async () => {
  expect(await updateDownloadStatus()).toEqual({ kind: 'downloading', progress: 35, message: '' });
});
it('hands a downloaded APK to the installer', async () => {
  expect(canInstallUpdate()).toBe(true);
  expect(await installUpdate()).toBe('installer');
});
it('keeps the permission step visible until Android permits installation', async () => {
  mockUpdater.canInstall.mockReturnValueOnce(false);
  mockUpdater.install.mockResolvedValueOnce('permission');
  expect(canInstallUpdate()).toBe(false);
  expect(await installUpdate()).toBe('permission');
});
