// GENERATED from packages/shared/lyricsText.ts by `npm run sync:shared`. Do not edit here.
/**
 * Lyric-site text down to the sung lines: what a lyrics page wraps around the words (an intro
 * paragraph, credits, part dividers, singer labels, "(x2)") is removed or expanded, so the lines
 * are the ones the singers actually sing. Pure and dependency-free: the API gets a generated copy.
 */

/** A song's text as stanzas of lines, the shape lyric pages are written in. */
export type LyricStanzas = string[][];

/** A repeat marker never writes a line out more often than this ("(20 times)" is a typo). */
const MAX_REPEAT = 4;

/** "Singers :", "Music Director :", "பாடகர்கள் :", "संगीत :"... with whatever follows. */
const CREDIT = new RegExp(
  '^(?:' +
    [
      'singers?', 'singer\\(s\\)', 'vocals?', 'music(?:\\s+director)?', 'music\\s+by', 'composer', 'composed\\s+by',
      'lyricists?', 'lyrics(?:\\s+by)?', 'written\\s+by', 'starring', 'cast', 'movie', 'film', 'album', 'label', 'director',
      'பாடகர்(?:கள்)?', 'பாடகி', 'இசையமைப்பாளர்', 'இசை', 'பாடலாசிரியர்', 'பாடல்\\s*வரிகள்', 'நடிகர்கள்', 'திரைப்படம்',
      'గాయకులు', 'గాయకుడు', 'గాయని', 'సంగీతం', 'సంగీత\\s*దర్శకుడు', 'సాహిత్యం', 'రచన',
      'गायक', 'गायिका', 'संगीत(?:कार)?', 'गीतकार', 'गीत',
      'ഗായകർ', 'ഗായകൻ', 'ഗായിക', 'സംഗീതം', 'ഗാനരചന',
      'ಗಾಯಕರು', 'ಗಾಯಕ', 'ಸಂಗೀತ', 'ಸಾಹಿತ್ಯ'
    ].join('|') +
    ')\\s*[:：]',
  'iu'
);

/** The paragraph a lyrics site opens with: "Mozhiye Song Lyrics is the track from Baththa Film...". */
const INTRO = /\blyrics\s+is\s+the\s+track\s+from\b|\bthis\s+song\s+(?:was|is)\s+sung\s+by\b|\bthe\s+music\s+(?:was|is)\s+composed\b|\blyrics\s+(?:works\s+)?(?:were\s+|was\s+)?penned\s+by\b/iu;

/** Who sings the line ("Female :", "ஆண் :", "కోరస్ :"), in front of the words. */
const LABEL = new RegExp(
  '^(?:' +
    [
      '(?:male|female|chorus|both|all|group|kids?|children|boys?|girls?|m|f)(?:\\s*\\d+)?',
      'ஆண்(?:கள்)?', 'பெண்(?:கள்)?', 'குழு', 'இருவர்', 'அனைவர்', 'சிறுவர்கள்', 'சிறுமி',
      'కోరస్', 'పురుషుడు', 'స్త్రీ', 'అతడు', 'ఆమె', 'ఇద్దరూ',
      'पुरुष', 'महिला', 'कोरस', 'सभी', 'दोनों',
      'പുരുഷൻ', 'സ്ത്രീ', 'കോറസ്',
      'ಗಂಡು', 'ಹೆಣ್ಣು', 'ಕೋರಸ್'
    ].join('|') +
    ')\\s*[:：]\\s*',
  'iu'
);

/** "(Male)" / "[Chorus]" written before the words instead of "Male :". */
const BRACKET_LABEL = /^[([](?:male|female|chorus|both|all|group|humming)[)\]]\s*/iu;

/** A line that only names a part or a break: "Male Part", "Chorus", "Music : ………", "BGM", "(Interlude)". */
const DIVIDER = /^[([]?(?:(?:male|female|chorus|both|all|group)(?:\s+(?:part|voice|vocals?))?|music|bgm|interlude|instrumental|humming|prelude|verse\s*\d*|hook|bridge|outro|intro)[)\]]?\s*[:：]?\s*[.…·-]*$/iu;

/** "(x2)", "x3", "(2 times)", "2 times", "(Repeat)" at the end of a line. */
const LINE_REPEAT = /\s*(?:[([]\s*(?:x\s*(\d+)|(\d+)\s*(?:x|times?)|repeat(?:\s*(\d+)\s*times?)?)\s*[)\]]|\s(?:x\s*(\d+)|(\d+)\s*times))\s*$/iu;

/** The "}(3)" that closes a "{ ... }" block sung several times. */
const BLOCK_CLOSE = /\}\s*(?:[([]\s*(?:x\s*)?(\d+)\s*(?:x|times?)?\s*[)\]]|x\s*(\d+))?\s*$/iu;

/** A stanza that only says "sing the last one again". */
const STANZA_REPEAT = /^[([]?\s*(?:repeat|repeat\s+(?:above|again)|again)\s*[)\]]?$/iu;

function hasLetters(line: string): boolean {
  return /\p{L}/u.test(line);
}

/** The first count a repeat marker gave, clamped to 1..MAX_REPEAT; a bare "(Repeat)" means twice. */
function repeatCount(groups: ReadonlyArray<string | undefined>): number {
  const value = groups.find((group) => group !== undefined);
  const count = value === undefined ? 2 : Number.parseInt(value, 10);
  return Math.min(MAX_REPEAT, Math.max(1, Number.isFinite(count) ? count : 2));
}

/**
 * One line with ellipses and curly quotes made plain and whitespace collapsed. Zero-width joiners
 * stay: Indic scripts need them.
 */
export function normaliseLyricLine(line: string): string {
  return line
    .normalize('NFC')
    .replace(/\u{2026}/gu, '...')
    .replace(/[\u{2018}\u{2019}\u{201B}\u{2032}]/gu, "'")
    .replace(/[\u{201C}\u{201D}\u{201F}\u{2033}]/gu, '"')
    .replace(/\u{00A0}/gu, ' ')
    .replace(/[\u{200B}\u{FEFF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One line without its singer label, or null when it is a credit, intro or divider line. */
function sungLine(raw: string): string | null {
  const line = normaliseLyricLine(raw);
  if (!line || CREDIT.test(line) || INTRO.test(line) || DIVIDER.test(line)) {
    return null;
  }
  const words = line.replace(LABEL, '').replace(BRACKET_LABEL, '').trim();
  return words && !DIVIDER.test(words) ? words : null;
}

/** Appends `times` copies of the lines to `out`. */
function pushRepeated(out: string[], lines: readonly string[], times: number): void {
  for (let index = 0; index < times; index += 1) {
    out.push(...lines);
  }
}

/** "{a / b }(3)" sung three times, and "line (x2)" twice, as the real lines. */
function expandRepeats(lines: readonly string[]): string[] {
  const out: string[] = [];
  let block: string[] | null = null;
  for (const line of lines) {
    let text = line;
    if (block === null && text.startsWith('{')) {
      block = [];
      text = text.slice(1).trim();
    }
    if (block !== null) {
      const close = text.match(BLOCK_CLOSE);
      if (close) {
        const words = text.slice(0, close.index).trim();
        if (words) {
          block.push(words);
        }
        pushRepeated(out, block, repeatCount([close[1], close[2]]));
        block = null;
      } else if (text) {
        block.push(text);
      }
      continue;
    }
    const repeat = text.match(LINE_REPEAT);
    if (repeat) {
      const words = text.slice(0, repeat.index).trim();
      if (words) {
        pushRepeated(out, [words], repeatCount(repeat.slice(1)));
      }
      continue;
    }
    out.push(text);
  }
  // A "{" never closed: keep its lines once.
  if (block !== null) {
    out.push(...block);
  }
  return out.map((line) => line.replace(/[{}]/g, '').trim()).filter(hasLetters);
}

/**
 * A lyric page's stanzas reduced to the sung lines: credits, the intro paragraph, part dividers
 * and singer labels removed; "(x2)", "{ ... }(3)" and a lone "Repeat" stanza written out.
 */
export function cleanLyricStanzas(stanzas: ReadonlyArray<readonly string[]>): LyricStanzas {
  const out: LyricStanzas = [];
  for (const stanza of stanzas) {
    const normalised = stanza.map(normaliseLyricLine).filter(Boolean);
    if (normalised.length === 1 && STANZA_REPEAT.test(normalised[0] ?? '')) {
      const previous = out.at(-1);
      if (previous) {
        out.push([...previous]);
      }
      continue;
    }
    const lines = expandRepeats(normalised.map(sungLine).filter((line): line is string => line !== null));
    if (lines.length > 0) {
      out.push(lines);
    }
  }
  return out;
}

/** Stanzas as plain text: a line per lyric, a blank line between stanzas. */
export function lyricStanzasText(stanzas: LyricStanzas): string {
  return stanzas.map((stanza) => stanza.join('\n')).join('\n\n');
}

/**
 * Romanised Indian-language spelling folded so variants compare equal ("Kanmaniyae" and
 * "Kanmaniye", "Azhage" and "Alage", "Thaene" and "Thene"). Lowercase letters and digits only.
 */
export function foldLatin(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .replace(/zh/g, 'l')
    .replace(/ae/g, 'e')
    .replace(/ee/g, 'i')
    .replace(/oo/g, 'u')
    .replace(/([bcdgjkpst])h/g, '$1')
    .replace(/w/g, 'v')
    .replace(/y(?=[aeiou])/g, '')
    .replace(/(.)\1+/g, '$1');
}

/**
 * A line that marks a music break rather than words: "[INSTRUMENTAL]", "[Instrumental Break]",
 * "(instrumental solo)", "♪ Instrumental ♪", or only music notes. Players draw a moving mark for it,
 * never the word. Empty text is not a break here (callers decide what a blank line means).
 */
export function isInstrumentalLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^[\s♪♫♬🎵🎶]+$/u.test(trimmed)) return true;
  const stripped = trimmed.replace(/^[\s[(【♪♫🎵🎶🎤]+/u, '').replace(/[\s\])】♪♫🎵🎶🎤]+$/u, '').trim();
  return /^(?:instrumental|music)(?:\s+(?:break|interlude|solo|outro|intro|section))?$/i.test(stripped);
}
