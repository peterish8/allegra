import { useSyncExternalStore } from 'react';
import { AppState } from 'react-native';
import { createAppActivitySource } from '../utils/appActivity';

const appActivity = createAppActivitySource(AppState);

/** True only while React Native reports the app in the active state. */
export const useAppActive = (): boolean =>
  useSyncExternalStore(appActivity.subscribe, appActivity.getSnapshot, appActivity.getServerSnapshot);
