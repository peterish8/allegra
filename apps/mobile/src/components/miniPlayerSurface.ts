/**
 * What the mini player's background draws (1.41.3, owner: "opaque, with the cover's glow, not transparent").
 *
 * Always opaque. With a cover it is the cover's glow; only a song with no cover gets the plain solid surface. On a
 * low-end phone or under Battery Saver the glow is still drawn but holds still (one frame, no animation clock), so
 * the colours stay without the cost. Reduce Transparency changes nothing here: the surface is already opaque.
 */
export interface MiniSurfaceConditions {
  uri?: string | null;
  lowEnd: boolean;
  batterySaver: boolean;
}

export type MiniSurfacePlan = { kind: 'solid' } | { kind: 'glow'; animate: boolean };

export const miniSurfacePlan = ({ uri, lowEnd, batterySaver }: MiniSurfaceConditions): MiniSurfacePlan =>
  !uri ? { kind: 'solid' } : { kind: 'glow', animate: !lowEnd && !batterySaver };
