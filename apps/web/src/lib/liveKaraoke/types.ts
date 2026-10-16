export type LiveKaraokeStatus =
  | 'idle'
  | 'loading'
  | 'processing'
  | 'active'
  /** Karaoke is on with the AI model, but the playhead is past what it has separated: the bridge plays. */
  | 'catching-up'
  | 'error';

/** `midside`: the live bridge (or, without Web Audio, a rendered file). `roformer`: the AI stems. */
export type LiveKaraokeBackend = 'midside' | 'roformer';

export interface LiveKaraokePrepareResult {
  readonly backend: LiveKaraokeBackend;
  readonly blobUrl: string;
  /** True when input was mono — vocal cancel is weak / none. */
  readonly monoSource: boolean;
  /** Why the AI model was skipped when backend is mid-side (shown to the listener). */
  readonly fallbackReason?: string;
}
