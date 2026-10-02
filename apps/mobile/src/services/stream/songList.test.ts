import { LIST_LIMIT, parseSongList, queryFor } from './songList';

describe('parseSongList', () => {
  it('reads title and artist split by a dash, "by" or a bar', () => {
    expect(parseSongList('Tum Hi Ho - Arijit Singh\nKesariya by Arijit Singh\nApna Bana Le | Arijit Singh')).toEqual([
      { title: 'Tum Hi Ho', artist: 'Arijit Singh' },
      { title: 'Kesariya', artist: 'Arijit Singh' },
      { title: 'Apna Bana Le', artist: 'Arijit Singh' },
    ]);
  });

  it('drops numbering and bullets, and accepts a title alone', () => {
    expect(parseSongList('1. Channa Mereya\n2) Raabta\n- Tera Ban Jaunga\n• Kabira')).toEqual([
      { title: 'Channa Mereya', artist: '' },
      { title: 'Raabta', artist: '' },
      { title: 'Tera Ban Jaunga', artist: '' },
      { title: 'Kabira', artist: '' },
    ]);
  });

  it('does not split a hyphen inside a word', () => {
    expect(parseSongList('Jai-Ho')).toEqual([{ title: 'Jai-Ho', artist: '' }]);
  });

  it('skips blank lines and one-character noise, and repeats', () => {
    expect(parseSongList('\n  \nA\nTum Hi Ho\ntum hi ho\r\n')).toEqual([{ title: 'Tum Hi Ho', artist: '' }]);
  });

  it('still accepts the old JSON list, ignoring bad entries', () => {
    expect(parseSongList('[{"title":"Kesariya","artist":"Arijit Singh"},{"artist":"x"},5,{"title":"Raabta"}]')).toEqual([
      { title: 'Kesariya', artist: 'Arijit Singh' },
      { title: 'Raabta', artist: '' },
    ]);
  });

  it('treats text that only looks like JSON as lines', () => {
    expect(parseSongList('[remix] Song - Artist')).toEqual([{ title: '[remix] Song', artist: 'Artist' }]);
  });

  it('stops at the limit', () => {
    const many = Array.from({ length: LIST_LIMIT + 20 }, (_, index) => `Song ${index}`).join('\n');
    expect(parseSongList(many)).toHaveLength(LIST_LIMIT);
  });
});

describe('queryFor', () => {
  it('searches both parts when there are two, the title alone otherwise', () => {
    expect(queryFor({ title: 'Kesariya', artist: 'Arijit Singh' })).toBe('Kesariya Arijit Singh');
    expect(queryFor({ title: 'Kesariya', artist: '' })).toBe('Kesariya');
  });
});
