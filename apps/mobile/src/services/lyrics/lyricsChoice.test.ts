import { lyricsKind, previewLines, rankOptions, LyricsOption } from './lyricsChoice';

describe('lyrics choice', () => {
  it('tells word-by-word, synced and plain lyrics apart', () => {
    expect(lyricsKind('[00:12.30]<00:12.300>Hel<00:12.520>lo')).toBe('words');
    expect(lyricsKind('[00:12.30]Hello\n[00:14.00]World')).toBe('synced');
    expect(lyricsKind('Hello\nWorld')).toBe('plain');
  });

  it('previews the first sung lines without tags or metadata', () => {
    const text = '[ar:Someone]\n[ti:Song]\n[00:01.00]\n[00:12.30]<00:12.300>Hel<00:12.520>lo world\n[00:14.00]Second  line\n[00:16.00]Third\n[00:18.00]Fourth';
    expect(previewLines(text)).toEqual(['Hello world', 'Second line', 'Third']);
    expect(previewLines('plain one\n\nplain two', 5)).toEqual(['plain one', 'plain two']);
  });

  it('lists good matches first, then by timing, then by score', () => {
    const o = (provider: string, kind: LyricsOption['kind'], score: number): LyricsOption =>
      ({ id: provider, provider, kind, score, lyrics: '', preview: [], reason: '' });
    const ranked = rankOptions([
      o('Plain', 'plain', 95),
      o('WrongSong', 'words', 20),
      o('Synced', 'synced', 80),
      o('Words', 'words', 70),
      o('Synced2', 'synced', 90),
    ]).map(x => x.provider);
    expect(ranked).toEqual(['Words', 'Synced2', 'Synced', 'Plain', 'WrongSong']);
  });
});
