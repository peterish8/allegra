/**
 * Blends on the phone: the account's Blends, and "Create a Blend" (consent, then the system share
 * sheet with the invite link). Same API and copy as the website.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { generateId } from '../utils/formatters';
import { FlatList, Pressable, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { BLEND_TEXT } from '@shared/blendCopy';
import { utcDay } from '@shared/blendLimits';
import type { BlendSummary } from '@shared/blendView';

import { blendStyles as s, ConsentSheet, MemberDiscs } from '../components/blend/BlendParts';
import { useAccount } from '../services/account/AccountProvider';
import { createBlend, inviteUrl, listBlends } from '../services/blend/blendApi';
import type { LibraryStackParamList } from '../types/navigation';

export const BlendsScreen: React.FC = () => {
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const account = useAccount();
  const [blends, setBlends] = useState<BlendSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
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
      <SafeAreaView style={s.screen} edges={['top']}>
        <Text style={s.title} accessibilityRole="header">Blends</Text>
        <View style={s.panel}>
          <Text style={s.panelBody}>{BLEND_TEXT.signin}</Text>
          <Pressable style={s.primary} onPress={() => void account.signInWithGoogle()} accessibilityRole="button">
            <Text style={s.primaryText}>Sign in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const today = utcDay(Date.now());
  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <FlatList
        data={blends}
        keyExtractor={(blend) => blend.id}
        ListHeaderComponent={
          <>
            <Text style={s.title} accessibilityRole="header">Blends</Text>
            <Text style={s.lead}>One playlist made from your taste and a friend&apos;s, refreshed every day.</Text>
            <View style={s.panel}>
              <Pressable style={s.primary} onPress={() => setConsent(true)} accessibilityRole="button">
                <Text style={s.primaryText}>Create a Blend</Text>
              </Pressable>
            </View>
            {error ? <Text style={s.note} accessibilityRole="alert">{error}</Text> : null}
          </>
        }
        renderItem={({ item }) => (
          <Pressable style={s.row} onPress={() => navigation.navigate('Blend', { blendId: item.id })} accessibilityRole="button" accessibilityLabel={item.name}>
            <MemberDiscs members={item.members} />
            <View style={s.rowText}>
              <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
              <Text style={s.rowMeta}>{item.memberCount < 2 ? 'Waiting for a friend' : item.builtFor === today ? 'Updated today' : 'Opens fresh today'}</Text>
            </View>
          </Pressable>
        )}
        contentContainerStyle={{ paddingBottom: 160 }}
      />
      <ConsentSheet visible={consent} mode="create" busy={busy} error={createError} onConfirm={() => void create()} onCancel={() => { setConsent(false); setCreateError(null); }} />
    </SafeAreaView>
  );
};

export default BlendsScreen;
