export interface HomePaginationState {
  hasScrolled: boolean;
  hasContinuation: boolean;
  isLoading: boolean;
  distanceFromEnd: number;
  nearEndThreshold: number;
  searchActive: boolean;
  chipActive: boolean;
}

/** True only after the listener has scrolled close to the end of the home feed. */
export const shouldLoadMoreHome = ({
  hasScrolled,
  hasContinuation,
  isLoading,
  distanceFromEnd,
  nearEndThreshold,
  searchActive,
  chipActive,
}: HomePaginationState): boolean =>
  hasScrolled
  && hasContinuation
  && !isLoading
  && !searchActive
  && !chipActive
  && distanceFromEnd <= nearEndThreshold;
