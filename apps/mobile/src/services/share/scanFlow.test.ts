import { isLooking, SCAN_START, scanReducer, scanStatus, type ScanState } from './scanFlow';

const run = (events: Parameters<typeof scanReducer>[1][], from: ScanState = SCAN_START) => events.reduce(scanReducer, from);

describe('the scanner phases', () => {
  test('a read code locks, looks up and shows a result', () => {
    expect(run([{ type: 'found' }]).phase).toBe('locked');
    expect(run([{ type: 'found' }, { type: 'lookup' }]).phase).toBe('resolving');
    expect(run([{ type: 'found' }, { type: 'lookup' }, { type: 'resolved' }]).phase).toBe('result');
  });
  test('a fast answer can skip the visible lookup', () => {
    expect(run([{ type: 'found' }, { type: 'resolved' }]).phase).toBe('result');
  });
  test('a second read while one is being looked up starts nothing new', () => {
    const resolving = run([{ type: 'found' }, { type: 'lookup' }]);
    expect(scanReducer(resolving, { type: 'found' })).toBe(resolving);
    expect(isLooking(resolving)).toBe(false);
  });
  test('a failure is said and can be scanned again', () => {
    const failed = run([{ type: 'found' }, { type: 'lookup' }, { type: 'failed', failure: 'gone' }]);
    expect(failed).toEqual({ phase: 'failed', failure: 'gone' });
    expect(isLooking(run([{ type: 'reset' }], failed))).toBe(true);
  });
  test('an answer that arrives with nothing being looked up is ignored', () => {
    expect(run([{ type: 'resolved' }]).phase).toBe('scanning');
    expect(run([{ type: 'failed', failure: 'gone' }]).phase).toBe('scanning');
  });
  test('the camera only looks while scanning', () => {
    expect(isLooking(SCAN_START)).toBe(true);
    expect(isLooking({ phase: 'result' })).toBe(false);
  });
});

describe('the words under the frame', () => {
  test('say what is happening in sentence case', () => {
    expect(scanStatus(SCAN_START)).toBe('Point at a LuvLyrics code');
    expect(scanStatus({ phase: 'resolving' }, 'playlist')).toBe('Finding the playlist');
    expect(scanStatus({ phase: 'resolving' }, 'song')).toBe('Finding the song');
  });
  test('tell a dead code from a dead connection', () => {
    expect(scanStatus({ phase: 'failed', failure: 'unreachable' })).toMatch(/Could not reach LuvLyrics/);
    expect(scanStatus({ phase: 'failed', failure: 'gone' }, 'playlist')).toMatch(/no longer shared/);
    expect(scanStatus({ phase: 'failed', failure: 'gone' }, 'song')).toMatch(/could not be found/);
  });
});

describe('the scanner screen', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const read = (rel: string) => (require('fs') as typeof import('fs')).readFileSync(require('path').join(__dirname, '..', '..', rel), 'utf8');
  test('shows a result card with Save and Open instead of leaving at once, and keeps the camera off while it resolves', () => {
    const screen = read('screens/ScanCodeScreen.tsx');
    expect(screen).toMatch(/<ScanResultCard /);
    expect(screen).toMatch(/resolveScanned\(payload\)/);
    expect(screen).toMatch(/!looking\) return/);
    expect(screen).not.toMatch(/checkShareTarget/);
  });
  test('animates transform and opacity only, with times from the tokens', () => {
    for (const file of ['components/share/ScanFrame.tsx', 'components/share/ScanResultCard.tsx']) {
      const src = read(file);
      expect(src).not.toMatch(/\b(width|height|top|left|boxShadow)\s*:\s*[a-z]+\.value/);
      expect(src).not.toMatch(/duration:\s*\d/);
      expect(src).toMatch(/useReducedMotion/);
    }
  });
});
