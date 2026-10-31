export interface AppliedLuvLinkAnchor {
  readonly roomId: string;
  readonly leaderEpoch: number;
  readonly sequence: number;
  readonly songRef: string | null;
}

export function isAppliedLuvLinkPlayerEcho(
  applied: AppliedLuvLinkAnchor | null,
  current: { readonly roomId: string | null; readonly leaderEpoch: number | null; readonly sequence: number | null; readonly songRef: string | null },
): boolean {
  return applied !== null
    && applied.roomId === current.roomId
    && applied.leaderEpoch === current.leaderEpoch
    && applied.sequence === current.sequence
    && applied.songRef === current.songRef;
}
