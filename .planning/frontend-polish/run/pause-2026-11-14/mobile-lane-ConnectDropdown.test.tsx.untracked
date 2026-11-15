import React from 'react';

const mockOpenDevices = jest.fn();
let mockConnect: { openDevices: () => void; remotePlayback: boolean; view: { activeDevice?: { name: string } } | null } = {
  openDevices: mockOpenDevices, remotePlayback: false, view: null,
};
jest.mock('react-native', () => ({ StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 } }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: 'MaterialCommunityIcons' }));
jest.mock('../../ui', () => ({ Tactile: 'Tactile' }));
jest.mock('../../utils/haptics', () => ({ selectionAsync: () => Promise.resolve() }));
jest.mock('../../services/connect/ConnectProvider', () => ({ useConnect: () => mockConnect }));
import { ConnectDropdown } from './ConnectDropdown';

type Element = React.ReactElement<Record<string, unknown>>;
const render = (): Element => ConnectDropdown() as Element;

beforeEach(() => {
  mockOpenDevices.mockClear();
  mockConnect = { openDevices: mockOpenDevices, remotePlayback: false, view: null };
});

it('opens the one shared devices sheet instead of its own', () => {
  const trigger = render();
  (trigger.props.onPress as () => void)();
  expect(mockOpenDevices).toHaveBeenCalledTimes(1);
});

it('renders only the trigger: no Sheet of its own', () => {
  const trigger = render();
  expect(trigger.type).toBe('Tactile');
  expect(trigger.props.accessibilityRole).toBe('button');
  expect(trigger.props.accessibilityState).toBeUndefined();
});

it('names the device it is playing on, and says "Connect devices" otherwise', () => {
  expect(render().props.accessibilityLabel).toBe('Connect devices');
  mockConnect = { ...mockConnect, view: { activeDevice: { name: 'Kitchen' } } };
  expect(render().props.accessibilityLabel).toBe('Connect, playing on Kitchen');
});

it('lights the icon while playback is remote', () => {
  const idle = (render().props.style as unknown[]).filter(Boolean);
  mockConnect = { ...mockConnect, remotePlayback: true };
  const remote = (render().props.style as unknown[]).filter(Boolean);
  expect(remote.length).toBe(idle.length + 1);
});
