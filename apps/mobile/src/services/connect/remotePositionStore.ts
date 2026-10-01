import { create } from 'zustand';

interface RemotePositionState {
  readonly positionSec: number;
}

export const useConnectPositionStore = create<RemotePositionState>(() => ({ positionSec: 0 }));

export const setConnectPosition = (positionSec: number): void => {
  if (Number.isFinite(positionSec) && useConnectPositionStore.getState().positionSec !== positionSec) {
    useConnectPositionStore.setState({ positionSec });
  }
};
