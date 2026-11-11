export const QUEUE_FOLLOW_QUIET_MS = 3000;

export function shouldFollowQueueIndex(input: {
  readonly open: boolean;
  readonly panelDragging: boolean;
  readonly listDragging: boolean;
  readonly lastInteractionAt: number;
  readonly now: number;
  readonly rowVisible: boolean;
}): boolean {
  return input.open
    && !input.panelDragging
    && !input.listDragging
    && input.now - input.lastInteractionAt >= QUEUE_FOLLOW_QUIET_MS
    && input.rowVisible;
}
