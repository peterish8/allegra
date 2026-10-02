/**
 * Looking for a newer build and remembering the answer (store/updateStore). Two callers: the app on its
 * own a moment after start-up (`checkInBackground`, at most every few hours, only if the listener left
 * automatic checks on), and the About sheet's own button (`checkNow`).
 */
import { useUpdateStore, type AvailableBuild } from '../store/updateStore';
import { fetchLatestBuild, INSTALLED_BUILD, shouldAutoCheck, standingOf, type LatestBuild } from './appUpdate';

/** The part of a build worth keeping between launches, or null when it is no newer than this phone. */
export const availableFrom = (build: LatestBuild | null): AvailableBuild | null =>
  build && standingOf(build, INSTALLED_BUILD) === 'update'
    ? { commit: build.commit, version: build.version, publishedAt: build.publishedAt.toISOString() }
    : null;

/** Look now, remember what was found, and hand the build back for the caller to show. */
export const checkNow = async (): Promise<LatestBuild | null> => {
  const build = await fetchLatestBuild();
  // A failed look says nothing about whether there is an update: keep what was known, and do not call it a check.
  if (build) useUpdateStore.getState().recordCheck(new Date(), availableFrom(build));
  return build;
};

/** Start-up check: skipped when the listener turned it off or looked recently. */
export const checkInBackground = async (now: Date = new Date()): Promise<void> => {
  const { autoCheck, lastCheckedAt } = useUpdateStore.getState();
  if (!autoCheck || !shouldAutoCheck(lastCheckedAt, now)) return;
  await checkNow();
};
