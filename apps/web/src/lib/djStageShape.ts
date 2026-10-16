/**
 * The DJ stage and its console as one piece of glass: a rounded stage whose bottom edge flows down into
 * a tab that holds the prompt. Each side of the tab is one long S-curve that leaves the stage's edge
 * level and lands level on the tab's bottom, so the shape reads as poured, not cut. Returns an SVG path
 * in the hero's own pixels, used both to clip the glass (`clip-path: path(...)`) and to draw its edge.
 *
 * When there is no room beside the tab for the curves, as on a phone, the shape is a plain rounded card.
 */
export interface DjStageShape {
  /** The whole hero: stage plus tab. */
  readonly width: number;
  readonly height: number;
  /** Where the stage ends and the tab begins. */
  readonly stageHeight: number;
  /** The tab's content box (left edge and width), in the hero's pixels. */
  readonly tabLeft: number;
  readonly tabWidth: number;
  /** Corner radius of the stage. */
  readonly radius: number;
  /** How far beyond the tab's content each curve starts on the stage's edge. */
  readonly spread: number;
  /** How far inside the tab's content each curve lands on the tab's bottom. */
  readonly tuck: number;
}

/** Less spread than this and the curve would be a kink: draw a plain card instead. */
const MIN_SPREAD = 28;
/** Gap kept between a curve's start and the stage's own rounded corner. */
const CORNER_GAP = 8;
/** Bezier handle length, as a share of the curve's width: about a smoothstep. */
const HANDLE = 0.55;

const r = (value: number): string => (Math.round(value * 10) / 10).toString();

export function djStagePath(shape: DjStageShape): string {
  const { width: w, height: h, stageHeight: yb } = shape;
  if (w <= 0 || h <= 0) return '';
  const radius = Math.max(0, Math.min(shape.radius, w / 2, yb / 2));
  const tabDepth = Math.max(0, h - yb);
  const left = Math.max(0, shape.tabLeft);
  const right = Math.min(w, shape.tabLeft + shape.tabWidth);
  const spread = Math.min(shape.spread, left - radius - CORNER_GAP, w - right - radius - CORNER_GAP);
  const tuck = Math.max(0, Math.min(shape.tuck, (right - left) / 4));

  const top = [
    `M0 ${r(radius)}`,
    `A${r(radius)} ${r(radius)} 0 0 1 ${r(radius)} 0`,
    `H${r(w - radius)}`,
    `A${r(radius)} ${r(radius)} 0 0 1 ${r(w)} ${r(radius)}`
  ];

  // A plain card: rounded top as the stage, rounded bottom as the tab.
  if (tabDepth < 1 || spread < MIN_SPREAD) {
    const bottom = Math.max(0, Math.min(radius, h / 2));
    return [
      ...top,
      `V${r(h - bottom)}`,
      `A${r(bottom)} ${r(bottom)} 0 0 1 ${r(w - bottom)} ${r(h)}`,
      `H${r(bottom)}`,
      `A${r(bottom)} ${r(bottom)} 0 0 1 0 ${r(h - bottom)}`,
      'Z'
    ].join(' ');
  }

  const handle = (spread + tuck) * HANDLE;
  return [
    ...top,
    `V${r(yb - radius)}`,
    `A${r(radius)} ${r(radius)} 0 0 1 ${r(w - radius)} ${r(yb)}`,
    `H${r(right + spread)}`,
    // Right side: level off the stage, down, level onto the tab's bottom.
    `C${r(right + spread - handle)} ${r(yb)} ${r(right - tuck + handle)} ${r(h)} ${r(right - tuck)} ${r(h)}`,
    `H${r(left + tuck)}`,
    `C${r(left + tuck - handle)} ${r(h)} ${r(left - spread + handle)} ${r(yb)} ${r(left - spread)} ${r(yb)}`,
    `H${r(radius)}`,
    `A${r(radius)} ${r(radius)} 0 0 1 0 ${r(yb - radius)}`,
    'Z'
  ].join(' ');
}
