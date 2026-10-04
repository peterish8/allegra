/** A lost React instance's error as `recovery/UiRecovery.kt` records it. Pure, so it is tested on its own. */
export interface UiCrash {
  /** When it happened (ms since the epoch); 0 when the record has no time. */
  at: number;
  /** The first line: the exception and its message. */
  summary: string;
  /** Everything recorded, for a bug report. */
  details: string;
}

/** The time on the first line, then the exception and its stack. Null when nothing was recorded. */
export function parseUiCrash(raw: string | null | undefined): UiCrash | null {
  if (!raw || !raw.trim()) return null;
  const lines = raw.split('\n');
  const first = lines[0]?.trim() ?? '';
  const at = /^\d+$/.test(first) ? Number(first) : 0;
  const body = (at ? lines.slice(1) : lines).join('\n').trim();
  if (!body) return null;
  const summary = body.split('\n')[0]?.trim() ?? body;
  return { at, summary, details: body };
}
