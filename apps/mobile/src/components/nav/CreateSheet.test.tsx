/* eslint-disable react-hooks/rules-of-hooks -- Presentation is inspected with a deterministic hook adapter. */
import React from 'react';
jest.mock('react', () => ({ ...jest.requireActual('react'), useEffect: jest.fn() }));
jest.mock('react-native', () => ({ BackHandler: { addEventListener: jest.fn() }, ScrollView: 'ScrollView', View: 'View', StyleSheet: { absoluteFill: {}, create: (styles: unknown) => styles } }));
jest.mock('react-native-reanimated', () => ({
  __esModule: true, default: { View: 'AnimatedView' },
  useSharedValue: (value: number) => ({ value }),
  useReducedMotion: () => false,
  useAnimatedReaction: jest.fn(),
  useAnimatedStyle: (read: () => unknown) => read(),
}));
jest.mock('../../navigation/sheetProgress', () => ({ createSheetProgress: { value: 0 } }));
jest.mock('../../ui', () => ({ ListRow: 'ListRow', Tactile: 'Tactile', Motion: {}, Radius: { sheet: 16 }, Space: { sm: 8, md: 16, xl: 32 }, Surface: { scrim: '#000', raised: '#17191E' } }));
import { CreateSheet } from './CreateSheet';
import { CREATE_ITEMS } from '../../navigation/createMenu';

type Element = React.ReactElement<Record<string, unknown>>;
function inspect(open: boolean) {
  const onPick = jest.fn();
  const onClose = jest.fn();
  const root = CreateSheet({ open, bottom: 80, maxHeight: 650, onPick, onClose }) as Element;
  const [backdrop, card] = React.Children.toArray(root.props.children as React.ReactNode) as Element[];
  return { root, backdrop, card, onPick, onClose };
}
it('keeps the full-width card mounted on close so its exit can finish', () => {
  const { root, card } = inspect(false);
  expect(root.props.pointerEvents).toBe('none');
  expect(root.props.accessibilityElementsHidden).toBe(true);
  expect((card.props.style as Record<string, unknown>[])[0]).toMatchObject({ left: 0, right: 0 });
  expect(card.props.accessibilityViewIsModal).toBe(false);
});
it('retains our four actions and dismisses from the backdrop', () => {
  const { card, backdrop, onPick, onClose } = inspect(true);
  const scroll = card.props.children as Element;
  const rows = React.Children.toArray(scroll.props.children as React.ReactNode) as Element[];
  expect(rows.map(row => row.props.title)).toEqual(CREATE_ITEMS.map(item => item.title));
  rows.forEach(row => (row.props.onPress as () => void)());
  expect(onPick.mock.calls.map(call => call[0])).toEqual(['luvs', 'playlist', 'blend', 'luvlink']);
  (backdrop.props.onPress as () => void)();
  expect(onClose).toHaveBeenCalledTimes(1);
});
