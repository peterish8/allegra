import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanLyricStanzas, foldLatin, lyricStanzasText, normaliseLyricLine } from './lyricsText';

test('drops the intro paragraph, credits and the music breaks', () => {
  const stanzas = cleanLyricStanzas([
    ['Vaazhanum baththa Song Lyrics is the track from Baththa Tamil Film – 2026, Starring Vijay Sethupathi and Others. This song was sung by Sai Abhyankkar.'],
    ['Singer : Sai Abhyankkar'],
    ['Music Director : SaiAbhyankkar'],
    ['Lyricist : Karthik Netha'],
    ['Music : …………………..'],
    ['Vaa veliya paar ulagam un ulagame maarum', '', 'Vaan muzhukka nee parakka vaa pazhaya chitte'],
    ['Music : …………………']
  ]);
  assert.deepEqual(stanzas, [['Vaa veliya paar ulagam un ulagame maarum', 'Vaan muzhukka nee parakka vaa pazhaya chitte']]);
});

test('removes singer labels and part dividers in English and Tamil', () => {
  const stanzas = cleanLyricStanzas([
    ['Male Part'],
    ['Female : First line here', 'Male : Second line here'],
    ['பாடகர்கள் : ஒருவர் மற்றும் இருவர்', 'இசையமைப்பாளர் : ஒருவர்'],
    ['பெண் : முதல் வரி', 'ஆண் : இரண்டாம் வரி'],
    ['(Chorus) La la la'],
    ['Chorus']
  ]);
  assert.deepEqual(stanzas, [
    ['First line here', 'Second line here'],
    ['முதல் வரி', 'இரண்டாம் வரி'],
    ['La la la']
  ]);
});

test('writes out repeats: (x2), 2 times, { ... }(3) and a lone Repeat stanza', () => {
  const stanzas = cleanLyricStanzas([
    ['Hold on (x2)', 'Come back 2 times'],
    ['பெண் : {வா வா', 'ஆண் : ஹா ஹா }(3)'],
    ['Kanam kanam (Repeat)'],
    ['Repeat']
  ]);
  assert.deepEqual(stanzas, [
    ['Hold on', 'Hold on', 'Come back', 'Come back'],
    ['வா வா', 'ஹா ஹா', 'வா வா', 'ஹா ஹா', 'வா வா', 'ஹா ஹா'],
    ['Kanam kanam', 'Kanam kanam'],
    ['Kanam kanam', 'Kanam kanam']
  ]);
});

test('an unclosed brace keeps its lines once, and repeats are capped', () => {
  assert.deepEqual(cleanLyricStanzas([['{Open line', 'Second line']]), [['Open line', 'Second line']]);
  assert.equal(cleanLyricStanzas([['Again (20 times)']])[0]?.length, 4);
});

test('normalises ellipses, curly quotes and odd spaces but keeps Indic joiners', () => {
  assert.equal(normaliseLyricLine('  Magale \u{2026}magale  \u{2018}kanne\u{2019} \u{201C}maniye\u{201D} '), 'Magale ...magale \'kanne\' "maniye"');
  assert.equal(normaliseLyricLine('Uyire\u{00A0}uyire\u{200B}\u{FEFF}'), 'Uyire uyire');
  const withJoiner = '\u{0D15}\u{0D4D}\u{200D}\u{0D37}';
  assert.equal(normaliseLyricLine(withJoiner), withJoiner);
});

test('stanzas as text put a blank line between stanzas', () => {
  assert.equal(lyricStanzasText([['a', 'b'], ['c']]), 'a\nb\n\nc');
});

test('folds romanised spelling variants together', () => {
  assert.equal(foldLatin('Kanmaniyae'), foldLatin('Kanmaniye'));
  assert.equal(foldLatin('Azhage'), foldLatin('Alage'));
  assert.equal(foldLatin('Thaene'), foldLatin('Thene'));
  assert.equal(foldLatin('Vaazhanum'), foldLatin('Vazhanum'));
  assert.notEqual(foldLatin('Mozhiye'), foldLatin('Uyire'));
});
