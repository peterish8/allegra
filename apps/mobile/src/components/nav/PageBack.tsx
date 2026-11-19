/**
 * The back arrow for a page pushed inside a tab that draws its own header over the cover glow, with no system bar
 * (Import, Blends, a Blend, Join a Blend). A solid system bar cut the glow off into a coloured band below it.
 */
import { useNavigation } from '@react-navigation/native';
import React from 'react';
import { IconButton } from '../../ui';

export function PageBack() {
  const navigation = useNavigation();
  if (!navigation.canGoBack()) return null;
  return <IconButton icon="arrow-back" label="Back" onPress={() => navigation.goBack()} />;
}
