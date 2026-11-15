import { streamCacheKeyFor } from './streamCacheKey';

const first = 'https://aac.saavncdn.com/123/abc_320.mp4?Expires=1&Signature=x';

describe('the song cache key', () => {
  it('matches the key Kotlin computes (StreamCacheKeyTest.JS_KEY)', () => {
    expect(streamCacheKeyFor('stream:saavn:AbC1', first)).toBe('v1|stream:saavn:AbC1|2e495ae43869cfe1');
  });

  it('ignores the signed query and separates other files', () => {
    expect(streamCacheKeyFor('stream:saavn:AbC1', 'https://aac.saavncdn.com/123/abc_320.mp4?Expires=2')).toBe(streamCacheKeyFor('stream:saavn:AbC1', first));
    expect(streamCacheKeyFor('stream:saavn:AbC1', 'https://aac.saavncdn.com/123/abc_160.mp4')).not.toBe(streamCacheKeyFor('stream:saavn:AbC1', first));
  });

  it('is null for files, content, plain http and blank ids', () => {
    expect(streamCacheKeyFor('a', 'file:///music/a.mp3')).toBeNull();
    expect(streamCacheKeyFor('a', 'content://media/external/audio/3')).toBeNull();
    expect(streamCacheKeyFor('a', 'http://plain.example/a.mp3')).toBeNull();
    expect(streamCacheKeyFor(' ', first)).toBeNull();
  });
});
