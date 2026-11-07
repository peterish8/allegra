import { CODE_HEIGHT, CODE_WIDTH, encodeLuvCode, luvCodeLayout, type LuvCodePayload } from '@shared/luvCode';

/** A calm, dark colour from a name, deep enough that white bars always read on it. */
export function codeTint(seed: string): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 38% 30%)`;
}

/**
 * A LuvLyrics code (packages/shared/luvCode.ts): the mark and 25 bars, white on the cover's colour. Scanning it with
 * the LuvLyrics app (Search → camera) opens the song or playlist. Nothing renders for a share that has no code.
 */
export function LuvCodeCard({ payload, tint, label }: { readonly payload: LuvCodePayload; readonly tint: string; readonly label: string }) {
  const levels = encodeLuvCode(payload);
  if (!levels) return null;
  const layout = luvCodeLayout(levels);
  return (
    <figure className="luv-code">
      <svg viewBox={`0 0 ${CODE_WIDTH} ${CODE_HEIGHT}`} role="img" aria-label={`LuvLyrics code for ${label}. Scan it with the LuvLyrics app.`}>
        <rect width={CODE_WIDTH} height={CODE_HEIGHT} rx={14} fill={tint} />
        <circle cx={layout.mark.cx} cy={layout.mark.cy} r={layout.mark.r} fill="#ffffff" />
        <path d={layout.mark.heart} fill={tint} />
        {layout.bars.map((bar, i) => (
          <rect key={i} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx={bar.width / 2} fill="#ffffff" />
        ))}
      </svg>
      <figcaption>Scan with LuvLyrics: Search, then the camera</figcaption>
    </figure>
  );
}
