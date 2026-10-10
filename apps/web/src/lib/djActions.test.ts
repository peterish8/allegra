import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseDjAction } from './djActions';

const context = { playlistNames: ['Gym', 'Late Night Drive', 'Rain ☔'] };
const parse = (text: string) => parseDjAction(text, context);

describe('parseDjAction', () => {
  it('plays a song by name, keeping its spelling for the search', () => {
    assert.deepEqual(parse('play Kesariya'), { kind: 'play-song', query: 'Kesariya', karaoke: false, lyrics: false });
    assert.deepEqual(parse('Hey DJ, can you play Tum Hi Ho by Arijit please'), { kind: 'play-song', query: 'Tum Hi Ho by Arijit', karaoke: false, lyrics: false });
    assert.deepEqual(parse('put on yeshanagula song'), { kind: 'play-song', query: 'yeshanagula', karaoke: false, lyrics: false });
  });

  it('starts karaoke or lyrics on the way', () => {
    assert.deepEqual(parse('play Kesariya and start karaoke'), { kind: 'play-song', query: 'Kesariya', karaoke: true, lyrics: false });
    assert.deepEqual(parse('play Kesariya with karaoke'), { kind: 'play-song', query: 'Kesariya', karaoke: true, lyrics: false });
    assert.deepEqual(parse('sing Kesariya'), { kind: 'play-song', query: 'Kesariya', karaoke: true, lyrics: false });
    assert.deepEqual(parse('play Kesariya and show lyrics'), { kind: 'play-song', query: 'Kesariya', karaoke: false, lyrics: true });
  });

  it('leaves moods and sets to the DJ model', () => {
    for (const text of ['play something calm', 'play more like this', 'play some Tamil songs', 'play late night melodies', 'play songs like Kesariya', 'shuffle', 'late night tamil', 'who composed this song?']) {
      const action = parse(text);
      assert.ok(action === null || action.kind === 'shuffle', `${text} -> ${JSON.stringify(action)}`);
    }
  });

  it('plays playlists by name, liked songs, and shuffles them', () => {
    assert.deepEqual(parse('play my Gym playlist'), { kind: 'play-playlist', name: 'Gym', shuffle: false, karaoke: false });
    assert.deepEqual(parse('play late night drive'), { kind: 'play-playlist', name: 'Late Night Drive', shuffle: false, karaoke: false });
    assert.deepEqual(parse('shuffle my rain playlist'), { kind: 'play-playlist', name: 'Rain ☔', shuffle: true, karaoke: false });
    assert.deepEqual(parse('play playlist Roadtrip'), { kind: 'play-playlist', name: 'Roadtrip', shuffle: false, karaoke: false });
    assert.deepEqual(parse('play my liked songs'), { kind: 'play-liked', shuffle: false, karaoke: false });
    assert.deepEqual(parse('shuffle my favourites'), { kind: 'play-liked', shuffle: true, karaoke: false });
  });

  it('queues a song, next or at the end', () => {
    assert.deepEqual(parse('queue Kesariya'), { kind: 'queue-song', query: 'Kesariya', next: false });
    assert.deepEqual(parse('add Kesariya to the queue'), { kind: 'queue-song', query: 'Kesariya', next: false });
    assert.deepEqual(parse('play Kesariya next'), { kind: 'queue-song', query: 'Kesariya', next: true });
    assert.equal(parse('play next')?.kind, 'transport');
  });

  it('understands the transport, likes, karaoke, lyrics and shuffle', () => {
    assert.deepEqual(parse('pause'), { kind: 'transport', op: 'pause' });
    assert.deepEqual(parse('Stop the music.'), { kind: 'transport', op: 'pause' });
    assert.deepEqual(parse('play'), { kind: 'transport', op: 'resume' });
    assert.deepEqual(parse('skip this song'), { kind: 'transport', op: 'next' });
    assert.deepEqual(parse('go back'), { kind: 'transport', op: 'previous' });
    assert.deepEqual(parse('play it again'), { kind: 'transport', op: 'restart' });
    assert.deepEqual(parse('like this song'), { kind: 'like', on: true });
    assert.deepEqual(parse('I love this'), { kind: 'like', on: true });
    assert.deepEqual(parse('remove this from my likes'), { kind: 'like', on: false });
    assert.deepEqual(parse('start karaoke'), { kind: 'karaoke', on: true });
    assert.deepEqual(parse("let's sing"), { kind: 'karaoke', on: true });
    assert.deepEqual(parse('stop karaoke'), { kind: 'karaoke', on: false });
    assert.deepEqual(parse('show me the lyrics'), { kind: 'lyrics' });
    assert.deepEqual(parse('shuffle off'), { kind: 'shuffle', on: false });
  });

  it('opens places and answers what is playing', () => {
    assert.deepEqual(parse('open my library'), { kind: 'open', place: 'library' });
    assert.deepEqual(parse('take me home'), null);
    assert.deepEqual(parse('go to settings'), { kind: 'open', place: 'settings' });
    assert.deepEqual(parse("what's playing?"), { kind: 'now-playing' });
    assert.deepEqual(parse('who sings this'), { kind: 'now-playing' });
  });

  it('never takes a slash command', () => {
    assert.equal(parse('/late-night'), null);
  });
});
