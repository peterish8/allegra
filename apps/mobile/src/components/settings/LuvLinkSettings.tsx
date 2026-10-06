import React from 'react';
import { LayoutChangeEvent } from 'react-native';
import { Section, Action } from './SettingsKit';
import { useLuvLinkStore } from '../../store/luvLinkStore';
import { navigationRef } from '../../utils/navigationService';
import * as Haptics from '../../utils/haptics';

const LuvLinkSettings: React.FC<{ onLayout?: (event: LayoutChangeEvent) => void; onNotice: (text: string) => void }> = ({ onLayout }) => {
  const ownedRoom = useLuvLinkStore(s => s.ownedRoom);
  const legacyRoom = useLuvLinkStore(s => s.room);
  const open = () => {
    if (!navigationRef.isReady()) return;
    Haptics.selectionAsync().catch(() => undefined);
    navigationRef.navigate('LuvLink');
  };
  const summary = ownedRoom ? `In a LuvLink · ${ownedRoom.memberCount} people` : legacyRoom ? 'In an Echo room' : 'Make a room with your people';
  return (
    <Section id="together" summary={summary} icon="people-outline" title="LuvLink" lead="Share a song and stay in sync with your people." onLayout={onLayout}>
      <Action label={ownedRoom ? 'Open your LuvLink' : legacyRoom ? 'Open Echo room' : 'Start or join a LuvLink'} hint={ownedRoom || legacyRoom ? 'Manage the room and shared queue' : 'Invite your people and pick the first song together'} onPress={open} />
    </Section>
  );
};

export default LuvLinkSettings;
