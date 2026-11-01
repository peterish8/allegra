import { Buffer } from 'buffer';
import { EchoLyricsCascade } from './EchoLyricsCascade';
import { allegraVersions, firstNonNull, jioSaavn, kuGou, lrcLib, simpMusic, youLyPlus } from './providers';
import { mockFetch } from '../testing/mockFetch';

afterEach(() => EchoLyricsCascade.clearCache());

const query = { title: 'Blinding Lights', artist: 'The Weeknd', duration: 200 };

describe('firstNonNull', () => {
  it('resolves with the first non-null value and ignores rejections', async () => {
    const slow = new Promise<string | null>(r => setTimeout(() => r('slow'), 20));
    await expect(firstNonNull([Promise.reject(new Error('x')), Promise.resolve(null), slow])).resolves.toBe('slow');
    await expect(firstNonNull<string>([Promise.resolve(null)])).resolves.toBeNull();
    await expect(firstNonNull<string>([])).resolves.toBeNull();
  });
});

describe('youLyPlus', () => {
  it('keeps KPoe syllable timings as word tags', async () => {
    const f = mockFetch([['https://lyricsplus', {
      lyrics: [
        { time: 1000, text: 'Hello there', syllabus: [
          { text: 'Hel', time: 1000, duration: 200 },
          { text: 'lo', time: 1200, duration: 300 },
          { text: 'ooh', time: 1300, duration: 300, isBackground: true },
          { text: 'there', time: 1600, duration: 400 },
        ] },
      ],
    }]]);
    const hit = await youLyPlus(query);
    f.restore();
    expect(hit?.lyrics).toBe('[00:01.00]<00:01.000>Hel<00:01.200>lo <00:01.500><00:01.600>there<00:02.000>');
  });

  it('converts KPoe syllable lines to line LRC', async () => {
    const f = mockFetch([['https://lyricsplus', {
      lyrics: [
        { time: 1000, syllabus: [{ text: 'Hello ' }, { text: 'there' }] },
        { time: 2500, text: 'Second line' },
      ],
    }]]);
    const hit = await youLyPlus(query);
    f.restore();
    expect(hit).toEqual(expect.objectContaining({
      provider: 'YouLyPlus',
      synced: true,
      lyrics: '[00:01.00]Hello there\n[00:02.50]Second line',
    }));
  });
});

describe('simpMusic', () => {
  it('needs a video id and picks the closest duration', async () => {
    expect(await simpMusic(query)).toBeNull();
    const f = mockFetch([['https://api-lyrics.simpmusic.org/v1/', {
      type: 'success',
      data: [
        { durationSeconds: 120, syncedLyrics: '[00:01.00]wrong' },
        { durationSeconds: 201, syncedLyrics: '[00:01.00]right' },
      ],
    }]]);
    const hit = await simpMusic({ ...query, videoId: 'abc' });
    f.restore();
    expect(hit?.lyrics).toBe('[00:01.00]right');
  });
});

describe('kuGou', () => {
  it('decodes base64 LRC and strips credit lines', async () => {
    const lrc = '[00:00.00]作词 : Someone\n[00:00.50]Composer: X\n[00:10.00]First real line\n[00:12.00]Second';
    const f = mockFetch([
      ['https://mobileservice.kugou.com', { data: { info: [{ duration: 201, hash: 'H' }] } }],
      ['https://lyrics.kugou.com/search', { candidates: [{ id: 7, accesskey: 'K' }] }],
      ['https://lyrics.kugou.com/download', { content: Buffer.from(lrc, 'utf8').toString('base64') }],
    ]);
    const hit = await kuGou(query);
    f.restore();
    expect(hit?.lyrics).toBe('[00:10.00]First real line\n[00:12.00]Second');
  });
});

describe('lrcLib', () => {
  const credited = { title: 'One Sun One Moon', artist: 'Anirudh Ravichander, Super Subu, M.S Krsna, Heisenberg', duration: 217 };
  const synced = '[00:02.81] Halki lagan';

  it('falls back to the lead artist when LRCLIB has nothing under the full credit', async () => {
    const f = mockFetch([
      ['https://lrclib.net/api/get', url => (url.includes('Super%20Subu') ? null : {
        trackName: 'One Sun One Moon', artistName: 'Anirudh Ravichander', duration: 217, syncedLyrics: synced,
      })],
      ['https://lrclib.net/api/search', []],
    ]);
    const hit = await lrcLib(credited);
    f.restore();
    expect(hit?.lyrics).toBe(synced);
    expect(hit?.synced).toBe(true);
    expect(f.calls.some(url => url.includes('artist_name=Anirudh%20Ravichander&'))).toBe(true);
  });

  it('asks only once when the credit is a single artist', async () => {
    const f = mockFetch([['https://lrclib.net/api/search', []]]);
    const hit = await lrcLib({ title: 'Nothing', artist: 'Anirudh Ravichander', duration: 217 });
    f.restore();
    expect(hit).toBeNull();
    expect(f.calls).toHaveLength(2);
  });

  it('keeps a full-credit match without looking up the lead artist', async () => {
    const f = mockFetch([['https://lrclib.net/api/get', {
      trackName: credited.title, artistName: credited.artist, duration: 217, syncedLyrics: synced,
    }]]);
    const hit = await lrcLib(credited);
    f.restore();
    expect(hit?.lyrics).toBe(synced);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('Super%20Subu');
  });

  it('rejects lead-artist search results with a different duration', async () => {
    const f = mockFetch([['https://lrclib.net/api/search', url => url.includes('Super%20Subu') ? [] : [{
      trackName: credited.title, artistName: 'Anirudh Ravichander', duration: 300, syncedLyrics: synced,
    }]]]);
    const hit = await lrcLib(credited);
    f.restore();
    expect(hit).toBeNull();
    expect(f.calls).toHaveLength(4);
  });
});

describe('EchoLyricsCascade.fetchBest', () => {
  it('skips plain results until a synced provider answers', async () => {
    const f = mockFetch([
      ['https://lyricsplus', { plainLyrics: 'plain words only' }],
      ['https://lrclib.net/api/get', { trackName: 'Blinding Lights', syncedLyrics: '[00:05.00]I been tryna call' }],
    ]);
    const hit = await EchoLyricsCascade.fetchBest(query);
    f.restore();
    expect(hit?.provider).toBe('LrcLib');
    expect(hit?.synced).toBe(true);
  });

  it('falls back to the first plain result, unless synced-only', async () => {
    const f = mockFetch([['https://lyricsplus', { plainLyrics: 'plain words only' }]]);
    const plain = await EchoLyricsCascade.fetchBest(query);
    EchoLyricsCascade.clearCache();
    const syncedOnly = await EchoLyricsCascade.fetchBest(query, undefined, true);
    f.restore();
    expect(plain).toEqual(expect.objectContaining({ provider: 'YouLyPlus', synced: false, lyrics: 'plain words only' }));
    expect(syncedOnly).toBeNull();
  });

  it('survives every provider being down', async () => {
    const f = mockFetch([]);
    await expect(EchoLyricsCascade.fetchBest(query)).resolves.toBeNull();
    f.restore();
  });

  it('remembers a song nobody has, and does not ask again', async () => {
    const f = mockFetch([]); // every provider answers 404: a clean "none"
    await expect(EchoLyricsCascade.fetchBest(query, ['LrcLib'])).resolves.toBeNull();
    const asked = f.calls.length;
    await expect(EchoLyricsCascade.fetchBest(query, ['LrcLib'])).resolves.toBeNull();
    f.restore();
    expect(asked).toBeGreaterThan(0);
    expect(f.calls.length).toBe(asked);
  });

  it('asks again after a lookup that hit a server error', async () => {
    const f = mockFetch([['https://lrclib.net', null]]); // 500
    await expect(EchoLyricsCascade.fetchBest(query, ['LrcLib'])).resolves.toBeNull();
    const asked = f.calls.length;
    await EchoLyricsCascade.fetchBest(query, ['LrcLib']);
    f.restore();
    expect(f.calls.length).toBeGreaterThan(asked);
  });
});

describe('EchoLyricsCascade.fetchBest cancelling', () => {
  /** A network where every request waits until it is aborted, recording each request's signal. */
  const hangingFetch = (): { signals: AbortSignal[]; restore: () => void } => {
    const original = global.fetch;
    const signals: AbortSignal[] = [];
    global.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (signal) {
        signals.push(signal);
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }
    })) as typeof fetch;
    return { signals, restore: () => { global.fetch = original; } };
  };

  it('answers null at once for a caller that gives up, and cancels the requests', async () => {
    const net = hangingFetch();
    const song = new AbortController();
    const answer = EchoLyricsCascade.fetchBest(query, ['LrcLib'], false, song.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    song.abort();
    await expect(answer).resolves.toBeNull();
    net.restore();
    expect(net.signals.length).toBeGreaterThan(0);
    expect(net.signals.every(signal => signal.aborted)).toBe(true);
  });

  it('keeps a shared lookup running while another caller still waits for it', async () => {
    const net = hangingFetch();
    const leaving = new AbortController();
    const staying = new AbortController();
    const first = EchoLyricsCascade.fetchBest(query, ['LrcLib'], false, leaving.signal);
    const second = EchoLyricsCascade.fetchBest(query, ['LrcLib'], false, staying.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    leaving.abort();
    await expect(first).resolves.toBeNull();
    expect(net.signals.some(signal => signal.aborted)).toBe(false);
    staying.abort();
    await expect(second).resolves.toBeNull();
    net.restore();
    expect(net.signals.every(signal => signal.aborted)).toBe(true);
  });

  it('does not remember a cancelled lookup as a miss', async () => {
    const net = hangingFetch();
    const song = new AbortController();
    const answer = EchoLyricsCascade.fetchBest(query, ['LrcLib'], false, song.signal);
    await new Promise(resolve => setTimeout(resolve, 0));
    song.abort();
    await answer;
    net.restore();
    const f = mockFetch([['https://lrclib.net/api/get', { trackName: 'Blinding Lights', syncedLyrics: '[00:05.00]I been tryna call' }]]);
    const hit = await EchoLyricsCascade.fetchBest(query, ['LrcLib']);
    f.restore();
    expect(hit?.synced).toBe(true);
  });
});

describe('Allegra and JioSaavn', () => {
  const mozhiye = { title: 'Mozhiye', artist: 'Sai Abhyankkar', duration: 232, ref: 'saavn:B4-hLCKJ' };
  const verified = {
    success: true,
    data: {
      ref: 'saavn:B4-hLCKJ', title: 'Mozhiye', artist: 'Sai Abhyankkar', duration: 232,
      versions: [
        { script: 'latin', language: 'ta', lrc: '[00:12.00]<00:12.000>Mozhiye <00:12.800>mozhiye<00:13.600>', syncedAt: 1 },
        { script: 'native', language: 'ta', lrc: '[00:12.00]மொழியே', syncedAt: 1 },
      ],
    },
  };

  it('lists every listener-synced version, English first, labelled by script', async () => {
    const f = mockFetch([['https://allegravibe.vercel.app/api/lyrics/verified', verified]]);
    const hits = await allegraVersions(mozhiye);
    f.restore();
    expect(hits.map(h => h.label)).toEqual(['Allegra · English', 'Allegra · Tamil']);
    expect(hits[0]).toEqual(expect.objectContaining({ provider: 'Allegra', synced: true }));
    expect(hits[0]?.lyrics).toContain('<00:12.800>mozhiye');
    expect(f.calls[0]).toContain('ref=saavn%3AB4-hLCKJ');
  });

  it('puts a listener sync ahead of every other provider', async () => {
    const f = mockFetch([
      ['https://allegravibe.vercel.app/api/lyrics/verified', verified],
      ['https://lrclib.net/api/get', { trackName: 'Mozhiye', syncedLyrics: '[00:05.00]someone else' }],
    ]);
    const hit = await EchoLyricsCascade.fetchBest(mozhiye);
    f.restore();
    expect(hit?.label).toBe('Allegra · English');
  });

  it('answers JioSaavn plain text only for a Saavn ref', async () => {
    const f = mockFetch([['https://www.jiosaavn.com/api.php', { lyrics: 'Hey yen goli sodave<br>Ra you&#039;re my only<br><br><br>Rowdy baby' }]]);
    const hit = await jioSaavn({ title: 'Rowdy Baby', artist: 'Dhanush', ref: 'saavn:_GIuQbB_' });
    const gaana = await jioSaavn({ title: 'Rowdy Baby', artist: 'Dhanush', ref: 'gaana:abc' });
    const none = await jioSaavn({ title: 'Rowdy Baby', artist: 'Dhanush' });
    f.restore();
    expect(hit).toEqual(expect.objectContaining({ provider: 'JioSaavn', synced: false, lyrics: "Hey yen goli sodave\nRa you're my only\n\nRowdy baby" }));
    expect(gaana).toBeNull();
    expect(none).toBeNull();
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]).toContain('lyrics_id=_GIuQbB_');
  });
});

describe('EchoLyricsCascade.fetchAll', () => {
  it('collects one result per answering provider', async () => {
    const f = mockFetch([
      ['https://lyricsplus', { syncedLyrics: '[00:01.00]a' }],
      ['https://lrclib.net/api/get', { syncedLyrics: '[00:01.00]b' }],
      ['https://lyrics-api.boidu.dev/getLyrics', { ttml: '<p begin="1s">c</p>' }],
    ]);
    const all = await EchoLyricsCascade.fetchAll(query);
    f.restore();
    expect(all.map(r => r.provider).sort()).toEqual(['BetterLyrics', 'LrcLib', 'YouLyPlus']);
  });
});
