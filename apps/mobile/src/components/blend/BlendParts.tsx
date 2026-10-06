/**
 * Small pieces of the phone's Blend screens: member discs, story cards and the consent sheet. The
 * words come from packages/shared/blendCopy.ts so they match the website exactly.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BLEND_TEXT, storyText } from '@shared/blendCopy';
import type { Story } from '@shared/blendStories';
import type { BlendDetail, BlendMemberView } from '@shared/blendView';

import { Glass, Radius, Signal, Space } from '../../constants/allegraTheme';

// The website's member tones in the same order (apps/web/src/lib/blendTones.ts), so a listener has
// one colour on both. All six are bright: the initials on a disc are dark ink, and orbs glow.
const DISC_COLOURS = [Signal.wave, '#6fc1ff', '#ee6b5f', '#b8a6ff', '#7fdcc0', '#ffc56b'];

function hash(text: string): number {
  let value = 0;
  for (let i = 0; i < text.length; i++) value = (value * 31 + text.charCodeAt(i)) >>> 0;
  return value;
}

/** A member's colour: the same on their disc, their story slides and their song rows. */
export const discColour = (userId: string): string => DISC_COLOURS[hash(userId) % DISC_COLOURS.length]!;

/** Initials on a coloured disc (D11): never a photo. */
export const MemberDisc: React.FC<{ member: Pick<BlendMemberView, 'userId' | 'displayName' | 'initials'>; size?: number }> = ({ member, size = 36 }) => (
  <View
    accessible
    accessibilityLabel={member.displayName}
    style={[styles.disc, { width: size, height: size, borderRadius: size / 2, backgroundColor: discColour(member.userId) }]}
  >
    <Text style={[styles.discText, { fontSize: Math.round(size * 0.36) }]}>{member.initials}</Text>
  </View>
);

export const MemberDiscs: React.FC<{ members: readonly BlendMemberView[]; size?: number }> = ({ members, size = 28 }) => (
  <View style={styles.discs}>
    {members.map((member, index) => (
      <View key={member.userId} style={index > 0 ? { marginLeft: -size / 4 } : undefined}>
        <MemberDisc member={member} size={size} />
      </View>
    ))}
  </View>
);

/** One card per story; the exhaustive switch makes a new Story kind a type error until it is drawn. */
const StoryCard: React.FC<{ story: Story; detail: BlendDetail }> = ({ story, detail }) => {
  const text = storyText(story, detail);
  switch (story.kind) {
    case 'match':
    case 'song':
    case 'directions':
    case 'artist':
    case 'gift':
    case 'brought':
    case 'groupMatch':
    case 'mostInTune':
    case 'leastInTune':
    case 'glue':
      return (
        <View style={styles.card} accessible accessibilityLabel={`${text.eyebrow}. ${text.headline}. ${text.detail ?? ''}`}>
          <Text style={styles.eyebrow}>{text.eyebrow}</Text>
          <Text style={[styles.headline, story.kind === 'match' && styles.headlineBig]}>{text.headline}</Text>
          {text.detail ? <Text style={styles.detail}>{text.detail}</Text> : null}
        </View>
      );
    default: {
      const unknown: never = story;
      return unknown;
    }
  }
};

/** The Blend's story cards, in the server's order; they scroll sideways and never advance by themselves. */
export const StoryCards: React.FC<{ detail: BlendDetail }> = ({ detail }) =>
  detail.stories.length === 0 ? null : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={252} decelerationRate="fast" contentContainerStyle={styles.cards}>
      {detail.stories.map((story, index) => <StoryCard key={`${story.kind}-${index}`} story={story} detail={detail} />)}
    </ScrollView>
  );

/** Asked before making or joining a Blend. "Not now" changes nothing. */
export const ConsentSheet: React.FC<{
  visible: boolean;
  mode: 'create' | 'join';
  inviterName?: string;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ visible, mode, inviterName, busy, error, onConfirm, onCancel }) => (
  <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
    <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Close" />
    <View style={styles.sheet} accessibilityViewIsModal>
      <Text style={styles.sheetTitle} accessibilityRole="header">{BLEND_TEXT.consentTitle}</Text>
      {mode === 'join' && inviterName ? <Text style={styles.sheetLead}>{inviterName} wants to Blend with you.</Text> : null}
      <Text style={styles.sheetBody}>{BLEND_TEXT.consentBody}</Text>
      <View style={styles.actions}>
        <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={onConfirm} accessibilityRole="button" accessibilityState={{ busy, disabled: busy }}>
          <Text style={styles.primaryText}>{busy ? (mode === 'create' ? 'Making it…' : 'Joining…') : mode === 'create' ? 'Make the Blend' : 'Join the Blend'}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.secondaryText}>Not now</Text>
        </Pressable>
      </View>
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  </Modal>
);

export const blendStyles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Signal.bg },
  title: { color: Signal.ink, fontSize: 28, fontWeight: '800', paddingHorizontal: Space.md, paddingTop: Space.md },
  lead: { color: Signal.inkMuted, fontSize: 14, paddingHorizontal: Space.md, paddingTop: Space.xs, paddingBottom: Space.md },
  panel: { marginHorizontal: Space.md, marginBottom: Space.sm, padding: Space.md, borderRadius: Radius.panel, backgroundColor: Glass.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline, gap: Space.xs },
  panelTitle: { color: Signal.ink, fontSize: 17, fontWeight: '700' },
  panelBody: { color: Signal.inkSoft, fontSize: 14, lineHeight: 20 },
  primary: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Space.md, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Signal.wave },
  primaryText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  secondary: { alignSelf: 'flex-start', minHeight: 44, paddingHorizontal: Space.md, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Glass.fillLight },
  secondaryText: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: 64, paddingHorizontal: Space.md },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  rowMeta: { color: Signal.inkMuted, fontSize: 12 },
  note: { color: Signal.inkMuted, fontSize: 13, paddingHorizontal: Space.md },
});

const styles = StyleSheet.create({
  disc: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: Signal.bg },
  discText: { color: Signal.waveInk, fontWeight: '800' },
  discs: { flexDirection: 'row', alignItems: 'center' },
  cards: { gap: Space.sm, paddingHorizontal: Space.md, paddingVertical: Space.xs },
  card: { width: 240, minHeight: 180, padding: Space.md, borderRadius: Radius.panel, backgroundColor: Glass.fill, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairline, gap: Space.xs },
  eyebrow: { color: Signal.inkMuted, fontSize: 11, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
  headline: { color: Signal.ink, fontSize: 18, fontWeight: '700', lineHeight: 24 },
  headlineBig: { fontSize: 44, lineHeight: 50, fontWeight: '800' },
  detail: { color: Signal.inkSoft, fontSize: 13, lineHeight: 18 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: Glass.scrim },
  sheet: { position: 'absolute', left: Space.md, right: Space.md, bottom: Space.lg, padding: Space.lg, borderRadius: Radius.sheet, backgroundColor: Glass.fillHeavy, borderWidth: StyleSheet.hairlineWidth, borderColor: Glass.hairlineStrong, gap: Space.sm },
  sheetTitle: { color: Signal.ink, fontSize: 20, fontWeight: '800' },
  sheetLead: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  sheetBody: { color: Signal.inkSoft, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.xs },
  primary: { minHeight: 44, paddingHorizontal: Space.md, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Signal.wave },
  primaryText: { color: Signal.waveInk, fontSize: 15, fontWeight: '700' },
  secondary: { minHeight: 44, paddingHorizontal: Space.md, justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: Glass.fillLight },
  secondaryText: { color: Signal.ink, fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.6 },
  error: { color: Signal.accentBright, fontSize: 13 },
});
