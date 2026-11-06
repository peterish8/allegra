import { cardListeningHint, fieldListeningHint, voiceFieldView } from './voiceFieldCopy';

describe('voice search copy follows the gesture (Round 7 item 6)', () => {
  it('says "Release to search" while the mic is held', () => {
    expect(fieldListeningHint('hold')).toBe('Release to search');
    expect(voiceFieldView('listening', 'hold', null, '')).toMatchObject({ status: 'Listening', busy: true, actions: ['cancel'] });
  });

  it('offers Stop after a tap, with Cancel always there', () => {
    expect(fieldListeningHint('tap')).toBe('Tap stop when you’re done');
    expect(voiceFieldView('listening', 'tap', null, '')?.actions).toEqual(['cancel', 'stop']);
  });

  it('no longer tells a tapping listener to let go on the floating card', () => {
    expect(cardListeningHint('tap')).not.toMatch(/let go/i);
    expect(cardListeningHint('hold')).toMatch(/let go/i);
  });

  it('keeps Cancel while it searches', () => {
    expect(voiceFieldView('searching', 'hold', null, 'small hours')).toMatchObject({ status: 'Searching', busy: true, actions: ['cancel'] });
  });

  it('says what it heard when nothing matched, and offers to listen again or type', () => {
    expect(voiceFieldView('empty', 'tap', null, 'mira vail')).toMatchObject({
      status: 'No match for “mira vail”', busy: false, actions: ['retry', 'type'],
    });
  });

  it('points to settings when the microphone is not allowed, and says typing still works', () => {
    const view = voiceFieldView('notice', 'hold', 'Allow the microphone to search by voice', '');
    expect(view).toMatchObject({ alert: true, actions: ['settings', 'dismiss'] });
    expect(view?.hint).toMatch(/Typing always works/);
  });

  it('offers to try again after any other problem, and shows nothing when idle or with results', () => {
    expect(voiceFieldView('notice', 'hold', 'Didn’t hear a song', '')?.actions).toEqual(['retry', 'dismiss']);
    expect(voiceFieldView('idle', 'hold', null, '')).toBeNull();
    expect(voiceFieldView('results', 'hold', null, 'x')).toBeNull();
  });
});
