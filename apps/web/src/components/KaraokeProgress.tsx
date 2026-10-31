import type { KaraokeStage } from '../hooks/useLiveKaraoke';

interface KaraokeProgressProps {
  readonly stage: KaraokeStage | null;
  readonly variant?: 'player' | 'lyrics';
}

/** A small, plain-language status for the current karaoke preparation step. */
export function KaraokeProgress({ stage, variant = 'player' }: KaraokeProgressProps) {
  if (!stage) return null;

  let title: string;
  switch (stage.kind) {
    case 'song':
      title = 'Preparing song audio';
      break;
    case 'model-check':
      title = 'Checking AI model';
      break;
    case 'model-download':
      title = 'Downloading AI model';
      break;
    case 'model-verify':
      title = 'Verifying AI model';
      break;
    case 'model-save':
      title = 'Saving AI model';
      break;
    case 'model-start':
      title = 'Starting AI model';
      break;
    case 'separating':
      title = stage.eta === null
        ? 'Separating vocals'
        : `Separating vocals · about ${Math.max(1, Math.round(stage.eta))} sec left`;
      break;
  }

  const download = stage.kind === 'model-download' ? stage : null;
  const loaded = download ? Math.min(download.total, Math.max(0, download.loaded)) : 0;
  const total = download ? Math.max(1, download.total) : 1;
  const percent = download ? Math.max(0, Math.min(100, (loaded / total) * 100)) : 0;
  const progressText = download
    ? `${(loaded / 1_000_000).toFixed(2)} / ${(total / 1_000_000).toFixed(2)} MB · ${percent.toFixed(1)}%`
    : null;

  return (
    <section className={`np-karaoke-progress np-karaoke-progress--${variant}`} aria-label="Karaoke progress">
      <div className="np-karaoke-progress__heading">
        <strong aria-live="polite" aria-atomic="true">{title}</strong>
        {progressText ? <span>{progressText}</span> : null}
      </div>
      {download ? (
        <div
          className="np-karaoke-progress__bar"
          role="progressbar"
          aria-label="AI model download"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Number(percent.toFixed(1))}
          aria-valuetext={`${loaded} of ${total} bytes downloaded (${percent.toFixed(1)} percent)`}
        >
          <span style={{ transform: `scaleX(${percent / 100})` }} />
        </div>
      ) : null}
    </section>
  );
}
