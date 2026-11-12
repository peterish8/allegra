import { AppSafeArea } from '../components/AppScreen';
/**
 * Blends on the phone: the account's Blends, and "Create a Blend" (consent, then the system share
 * sheet with the invite link). Same API and copy as the website.
 */
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { FlatList, Share, Text, View } from 'react-native';
import { generateId } from '../utils/formatters';

import { BLEND_TEXT } from '@shared/blendCopy';
import { utcDay } from '@shared/blendLimits';
import type { BlendSummary } from '@shared/blendView';

import { InfoTitleRow, InfoTour } from '../components/allegra/InfoTour';
import { BLENDS_TOUR, blendsLights, blendsScene } from '../components/allegra/infoTours';
import { ConsentSheet, MemberDiscs, blendStyles as s } from '../components/blend/BlendParts';
import { Signal, Space } from '../constants/allegraTheme';
import { useBottomClearance } from '../hooks/useBottomClearance';
import { useAccount } from '../services/account/AccountProvider';
import { createBlend, inviteUrl, listBlends } from '../services/blend/blendApi';
import type { LibraryStackParamList } from '../types/navigation';
import { Tactile, TactileRow } from '../ui';

export const BlendsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const account = useAccount();
  const [blends, setBlends] = useState<BlendSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const bottom = useBottomClearance();
  const token = account.signedIn ? account.token : null;
  const operationId = useRef<string | null>(null);
  const activeToken = useRef(token);
  activeToken.current = token;
  useEffect(() => { setBlends([]); setError(null); setConsent(false); setBusy(false); operationId.current = null; }, [account.profile?.userId]);

  const load = useCallback(async () => {
    if (!token) return;
    const result = await listBlends(token);
    if (activeToken.current !== token) return;
    if (result.ok === true) {
      setBlends(result.data);
      setError(null);
    } else {
      setError(result.error);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const create = async (): Promise<void> => {
    if (!token || busy) return;
    setBusy(true);
    setCreateError(null);
    operationId.current ??= generateId();
    const result = await createBlend(token, undefined, operationId.current);
    if (activeToken.current !== token) return;
    setBusy(false);
    if (result.ok === false) {
      setCreateError(result.code === 'limit' ? BLEND_TEXT.limit : result.error);
      return;
    }
    setConsent(false);
    operationId.current = null;
    void load();
    await Share.share({ message: `Blend with me on Allegra: ${inviteUrl(result.data.invite)}` }).catch(() => undefined);
    navigation.navigate('Blend', { blendId: result.data.id });
  };

  if (!token) {
    return (
      <AppSafeArea style={s.screen} edges={['top']}>
        <Text style={s.title} accessibilityRole="header">Blends</Text>
        <View style={s.panel}>
          <Text style={s.panelBody}>{BLEND_TEXT.signin}</Text>
          <Tactile style={s.primary} wrapperStyle={s.selfStart} onPress={() => void account.signInWithGoogle()} accessibilityRole="button">
            <Text style={s.primaryText}>Sign in</Text>
          </Tactile>
        </View>
      </AppSafeArea>
    );
  }

  const today = utcDay(Date.now());
  return (
    <AppSafeArea style={s.screen} edges={['top']}>
      <FlatList
        data={blends}
        keyExtractor={(blend) => blend.id}
        ListHeaderComponent={
          <>
            <InfoTitleRow style={{ paddingHorizontal: Space.md, paddingTop: Space.md, paddingBottom: Space.sm }}><Text style={[s.title, { padding: 0, paddingHorizontal: 0, paddingTop: 0 }]} accessibilityRole="header">Blends</Text><InfoTour label="What is a Blend?" steps={BLENDS_TOUR} scene={blendsScene} persist={blendsLights} /></InfoTitleRow>
            <View style={s.panel}>
              <Tactile style={s.primary} wrapperStyle={s.selfStart} onPress={() => setConsent(true)} accessibilityRole="button">
                <Text style={s.primaryText}>Create a Blend</Text>
              </Tactile>
            </View>
            {error ? <Text style={s.note} accessibilityRole="alert">{error}</Text> : null}
          </>
        }
        renderItem={({ item }) => (
          <TactileRow style={s.row} onPress={() => navigation.navigate('Blend', { blendId: item.id })} accessibilityRole="button" accessibilityLabel={item.name}>
            <MemberDiscs members={item.members} />
            <View style={s.rowText}>
              <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={s.rowMeta}>{item.memberCount < 2 ? 'Waiting for a friend' : item.builtFor === today ? 'Updated today' : 'Opens fresh today'}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={Signal.inkFaint} />
          </TactileRow>
        )}
        ListEmptyComponent={error ? null : <Text style={s.note}>A Blend mixes your taste with a friend's into one playlist that refreshes every day. Create one and send them the invite.</Text>}
        contentContainerStyle={{ paddingBottom: bottom }}
      />
      <ConsentSheet visible={consent} mode="create" busy={busy} error={createError} onConfirm={() => void create()} onCancel={() => { setConsent(false); setCreateError(null); }} />
    </AppSafeArea>
  );
};

export default BlendsScreen;
