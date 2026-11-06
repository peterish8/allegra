import { useEffect, useState } from 'react';
import { AccessibilityInfo, AppState } from 'react-native';

/** The system's Reduce Transparency setting, rechecked when the app returns to the foreground. */
export const useReduceTransparency = (): boolean => {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const refresh = () => {
      AccessibilityInfo.isReduceTransparencyEnabled().then(setReduce).catch(() => undefined);
    };
    refresh();
    const transparency = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    const app = AppState.addEventListener('change', state => { if (state === 'active') refresh(); });
    return () => { transparency.remove(); app.remove(); };
  }, []);
  return reduce;
};
