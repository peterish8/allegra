import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ConnectView } from '../../../../packages/connect/src/index';
import { onlyPositionMoved } from './connectView';

const devices: ConnectView['devices'] = [];
const queue: ConnectView['queue'] = [];

const view = (overrides: Partial<ConnectView> = {}): ConnectView => ({
  ready: true,
  devices,
  isThisDeviceActive: true,
  activeDeviceOnline: true,
  ownershipEpoch: 1,
  queue,
  queueEditable: true,
  isPlaying: true,
  livePosition: 10,
  volume: 1,
  shuffle: false,
  repeat: 'off',
  ...overrides,
} as ConnectView);

describe('onlyPositionMoved', () => {
  it('is true when this device plays and only the position changed', () => {
    assert.equal(onlyPositionMoved(view(), view({ livePosition: 10.25 })), true);
  });

  it('is false for the first view', () => {
    assert.equal(onlyPositionMoved(null, view()), false);
  });

  it('is false when anything else changed', () => {
    assert.equal(onlyPositionMoved(view(), view({ livePosition: 11, volume: 0.5 })), false);
    assert.equal(onlyPositionMoved(view(), view({ queue: [] })), false);
  });

  it('is false while another device plays or playback is paused, where the position is shown from the view', () => {
    assert.equal(onlyPositionMoved(view({ isThisDeviceActive: false }), view({ isThisDeviceActive: false, livePosition: 11 })), false);
    assert.equal(onlyPositionMoved(view(), view({ isPlaying: false, livePosition: 11 })), false);
  });
});
