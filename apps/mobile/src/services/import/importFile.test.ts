import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('expo-file-system/legacy', () => ({
  readAsStringAsync: jest.fn(),
  EncodingType: { Base64: 'base64' }
}));

import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from 'buffer';
import { readPickedImport, parseMobileImportBytes } from './importFile';

const fixture = (name: string): Buffer => readFileSync(join(__dirname, '../../../../../packages/shared/fixtures', name));

describe('mobile import file reader', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads Spotify ZIP metadata with stable playlist identities', () => {
    const result = parseMobileImportBytes('spotify.zip', new Uint8Array(fixture('spotify-export.zip')));
    expect('bundle' in result).toBe(true);
    if ('bundle' in result) {
      expect(result.bundle.liked).toHaveLength(4);
      expect(result.bundle.playlists).toHaveLength(2);
      expect(result.bundle.playlists[0]?.sourceId).toContain('playlist1.json:0');
      expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('parses JSON and CSV without sending or storing the local file', () => {
    const json = parseMobileImportBytes('YourLibrary.json', new Uint8Array(fixture('spotify-export/YourLibrary.json')));
    const csv = parseMobileImportBytes('liked.csv', new Uint8Array(fixture('spotify-export/exportify.csv')));
    expect('bundle' in json && json.bundle.liked).toHaveLength(4);
    expect('bundle' in csv && csv.bundle.liked).toHaveLength(6);
  });

  it('checks the picker file size before reading and decodes copied file bytes', async () => {
    expect(await readPickedImport({ name: 'large.zip', uri: 'file:///large', size: 21 * 1024 * 1024 })).toEqual({ error: 'too_large' });
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
    const csv = fixture('spotify-export/exportify.csv');
    jest.mocked(FileSystem.readAsStringAsync).mockResolvedValue(csv.toString('base64'));
    const result = await readPickedImport({ name: 'liked.csv', uri: 'file:///picked', size: csv.byteLength });
    expect('bundle' in result && result.bundle.liked).toHaveLength(6);
    expect(FileSystem.readAsStringAsync).toHaveBeenCalledWith('file:///picked', { encoding: FileSystem.EncodingType.Base64 });
  });
});
