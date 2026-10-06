import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RadioSession, baseTitle, radioReasonLabel, type RadioSong } from './radio.ts';

let next = 0;
function song(title: string, artist: string, language = 'hindi'): RadioSong {
  next += 1;
  return { id: `s${next}`, title, artist, language };
}

const seed = song('Kesariya', 'Pritam, Arijit Singh');
const arijit = [song('Tum Hi Ho', 'Arijit Singh'), song('Channa Mereya', 'Arijit Singh'), song('Agar Tum Saath Ho', 'Arijit Singh')];
const atif = [song('Tera Hone Laga Hoon', 'Atif Aslam'), song('Pehli Nazar Mein', 'Atif Aslam')];
const jubin = [song('Raataan Lambiyan', 'Jubin Nautiyal'), song('Lut Gaye', 'Jubin Nautiyal')];
const shreya = [song('Teri Ore', 'Shreya Ghoshal'), song('Sun Raha Hai', 'Shreya Ghoshal')];
const variants = [song('Kesariya (Lofi Flip)', 'VIBIE, Arijit Singh'), song('Kesariya - Slowed', 'Arijit Singh')];

function session(): RadioSession<RadioSong> {
  const radio = new RadioSession(seed);
  radio.add([...variants, arijit[0]!, atif[0]!, jubin[0]!, shreya[0]!, arijit[1]!, atif[1]!, jubin[1]!, shreya[1]!, arijit[2]!], 'similar');
  return radio;
}

const titles = (picks: readonly { song: RadioSong }[]): string[] => picks.map((pick) => pick.song.title);
const artists = (picks: readonly { song: RadioSong }[]): string[] => picks.map((pick) => pick.song.artist);

test('baseTitle folds remixes and versions onto the song', () => {
  assert.equal(baseTitle('Kesariya (Lofi Flip)'), 'kesariya');
  assert.equal(baseTitle('Kesariya - Slowed + Reverb'), 'kesariya');
  assert.equal(baseTitle('Kesariya Rangu'), 'kesariya rangu');
});

test('the radio never plays the seed again, nor a remix or cover of it', () => {
  const picks = session().next(20);
  assert.ok(!titles(picks).some((title) => baseTitle(title) === 'kesariya'));
});

test('the most similar songs lead, without the same artist twice in a row', () => {
  const picks = session().next(6);
  assert.equal(picks[0]?.song.title, 'Tum Hi Ho');
  for (let index = 1; index < picks.length; index += 1) {
    assert.notEqual(artists(picks)[index], artists(picks)[index - 1]);
  }
});

test('no artist takes more than two of the next ten', () => {
  const radio = new RadioSession(seed);
  radio.add([...arijit, song('Ae Dil Hai Mushkil', 'Arijit Singh'), ...atif], 'similar');
  const counts = new Map<string, number>();
  for (const pick of radio.next(10)) counts.set(pick.song.artist, (counts.get(pick.song.artist) ?? 0) + 1);
  assert.ok((counts.get('Arijit Singh') ?? 0) <= 2);
});

test('an early skip sinks that artist, a second one removes them', () => {
  const radio = session();
  radio.record(atif[0]!, 'early-skip');
  const afterOne = radio.next(5);
  assert.ok(titles(afterOne).indexOf('Pehli Nazar Mein') === -1 || titles(afterOne).indexOf('Pehli Nazar Mein') > 2);
  radio.record(jubin[0]!, 'heard');
  radio.record(atif[1]!, 'instant-skip');
  assert.ok(!artists(radio.next(20)).includes('Atif Aslam'));
});

test('a song skipped in its last seconds counts as liked and pulls its artist up', () => {
  const radio = session();
  const before = titles(radio.next(10)).indexOf('Sun Raha Hai');
  radio.record(shreya[0]!, 'finished');
  const after = titles(radio.next(10)).indexOf('Sun Raha Hai');
  assert.ok(after >= 0);
  assert.ok(before < 0 || after < before);
});

test('a finished song moves the centre: its neighbours rise', () => {
  const radio = session();
  const followUp = song('Manwa Laage', 'Shreya Ghoshal, Arijit Singh');
  const stranger = song('Dil Diyan Gallan', 'Atif Aslam');
  radio.add([followUp], 'similar', shreya[0]!);
  radio.add([stranger], 'similar');
  radio.record(shreya[0]!, 'finished');
  const picks = radio.next(12);
  assert.ok(titles(picks).indexOf('Manwa Laage') >= 0);
  assert.equal(radio.refillSeed.title, 'Teri Ore');
});

test('three early skips in a row make the radio follow the last song heard out', () => {
  const radio = session();
  const fromFinish = song('Ghungroo', 'Arijit Singh, Shilpa Rao');
  radio.add([fromFinish], 'similar', jubin[0]!);
  radio.record(jubin[0]!, 'finished');
  radio.record(arijit[0]!, 'early-skip');
  radio.record(atif[0]!, 'early-skip');
  radio.record(shreya[0]!, 'early-skip');
  assert.equal(radio.earlySkipStreak, 3);
  assert.equal(radio.next(1)[0]?.song.title, 'Ghungroo');
});

test('going back to a skipped song takes the skip back', () => {
  const radio = session();
  radio.record(atif[0]!, 'instant-skip');
  radio.record(jubin[0]!, 'instant-skip');
  radio.undoSkip(atif[0]!);
  radio.record(shreya[0]!, 'heard');
  assert.ok(artists(radio.next(20)).includes('Atif Aslam'));
  assert.equal(radio.earlySkipStreak, 1);
});

test('a listener’s favourite artists rank higher', () => {
  const plain = session();
  const tasteful = new RadioSession(seed, { artists: [{ name: 'Shreya Ghoshal', score: 10 }], languages: ['hindi'] });
  tasteful.add([...variants, arijit[0]!, atif[0]!, jubin[0]!, shreya[0]!, arijit[1]!, atif[1]!, jubin[1]!, shreya[1]!, arijit[2]!], 'similar');
  const plainAt = titles(plain.next(6)).indexOf('Teri Ore');
  const tastefulAt = titles(tasteful.next(6)).indexOf('Teri Ore');
  assert.ok(tastefulAt >= 0);
  assert.ok(plainAt < 0 || tastefulAt < plainAt);
});

test('songs in a language neither the seed nor the listener uses sink', () => {
  const radio = new RadioSession(seed);
  radio.add([song('Despacito', 'Luis Fonsi', 'spanish'), arijit[0]!], 'similar');
  assert.equal(radio.next(1)[0]?.song.title, 'Tum Hi Ho');
});

test('ids the listener queued are left out, and played songs never come back', () => {
  const radio = session();
  radio.markPlayed(arijit[0]!);
  const picks = radio.next(20, { exclude: [atif[0]!.id] });
  assert.ok(!titles(picks).includes('Tum Hi Ho'));
  assert.ok(!titles(picks).includes('Tera Hone Laga Hoon'));
});

test('agreeing sources beat a single source', () => {
  const radio = new RadioSession(seed);
  const both = song('Shayad', 'Arijit Singh');
  radio.add([song('Song A', 'Artist A'), both], 'similar');
  radio.add([both], 'mix');
  assert.equal(radio.next(1)[0]?.song.title, 'Shayad');
});

test('remaining counts what is still playable, so callers know when to refill', () => {
  const radio = session();
  const before = radio.remaining();
  radio.markPlayed(arijit[0]!);
  assert.equal(radio.remaining(), before - 1);
  assert.ok(radio.needsMore);
});

test('reasons read as quiet copy', () => {
  assert.equal(radioReasonLabel({ kind: 'seed', title: 'Kesariya' }), 'Like Kesariya');
  assert.equal(radioReasonLabel({ kind: 'discovery' }), 'Something new');
  assert.equal(radioReasonLabel({ kind: 'seed', title: 'Kesariya Rangu (From "Brahmastra")' }), 'Like Kesariya Rangu');
  const pick = session().next(1)[0];
  assert.equal(pick?.reason.kind, 'seed');
});
