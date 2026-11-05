/**
 * LuvLyrics UI — the one component library. Screens build from these and nothing else:
 *
 *   import { Button, IconButton, Chip, ListRow, Sheet, ConfirmSheet, Text, PageHeader } from '../ui';
 *
 * What each one is for, with examples and the rules behind them: apps/mobile/DESIGN.md.
 * Never style a Pressable by hand, pick a fontSize or a white-at-some-opacity in a screen, or write a duration:
 * if the library lacks something, add it here (and to DESIGN.md) so every screen gets it.
 */

// Tokens
export {
  Glass, Motion, OnMedia, Radius, Signal, Space, Surface, Control, Typography, TypeScale, PlayerType, BlurIntensity, criticallyDamped,
  type Weight,
} from '../constants/allegraTheme';

// Type
export { Text, toneColor, type TextProps, type TextTone, type TextVariant } from './Text';

// Actions
export { Button, ButtonRow, IconButton, TextButton, type ButtonProps, type ButtonVariant, type IconButtonProps, type IconName } from './Button';
export { Chip, ChipRow, type ChipProps } from './Chip';
export { Segmented, type SegmentedProps } from './Segmented';

// Lists
export { ListRow, SheetOption, CheckRow, ROW_HEIGHT, OPTION_HEIGHT, ROW_ART, type ListRowProps, type SheetOptionProps, type CheckRowProps } from './ListRow';

// Surfaces
export { Sheet, SheetScrollView, SheetScrollable, type SheetProps } from './Sheet';
export { ConfirmSheet, type ConfirmSheetProps } from './ConfirmSheet';
export { PageHeader, EmptyState, Panel, Placeholder, RowPlaceholder, GUTTER, type PageHeaderProps, type EmptyStateProps } from './Layout';
export { Frosted } from '../components/allegra/Frosted';
export { default as Artwork } from '../components/allegra/Artwork';
export { SectionHeading } from '../components/allegra/home';

// Motion and touch
export { Tactile, TactileRow, RiseIn, SwapText, MorphIcon, NudgeIcon, useSwapAnimations } from '../components/allegra/motion';
export { projectMomentum, rubberBand, releaseSpring, isFling } from '../components/allegra/physics';
export * as Haptics from '../utils/haptics';

// Layout helpers
export { useBottomClearance } from '../hooks/useBottomClearance';
export { Screen, CoverGlow } from './Screen';
export { SongRow, type SongRowProps } from './SongRow';
export { CollectionCard } from './CollectionCard';
export { PlaybackButton } from './PlaybackButton';
