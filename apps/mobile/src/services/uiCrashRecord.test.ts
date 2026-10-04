import { parseUiCrash } from './uiCrashRecord';

describe('parseUiCrash', () => {
  it('reads the time, the summary line and the whole record', () => {
    const raw = '1759560000000\ncom.facebook.react.common.JavascriptException: TypeError: x is undefined\n  at a.b(c.kt:1)\n';
    expect(parseUiCrash(raw)).toEqual({
      at: 1759560000000,
      summary: 'com.facebook.react.common.JavascriptException: TypeError: x is undefined',
      details: 'com.facebook.react.common.JavascriptException: TypeError: x is undefined\n  at a.b(c.kt:1)',
    });
  });

  it('keeps a record that has no time', () => {
    expect(parseUiCrash('java.lang.IllegalStateException: boom')).toEqual({
      at: 0,
      summary: 'java.lang.IllegalStateException: boom',
      details: 'java.lang.IllegalStateException: boom',
    });
  });

  it('is null when nothing was recorded', () => {
    expect(parseUiCrash(null)).toBeNull();
    expect(parseUiCrash('')).toBeNull();
    expect(parseUiCrash('1759560000000\n')).toBeNull();
  });
});
