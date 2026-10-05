import React, { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BLEND_TEXT } from '@shared/blendCopy';
import type { BlendInvitePreview } from '@shared/blendView';
import { blendStyles as s, ConsentSheet } from '../components/blend/BlendParts';
import { useAccount } from '../services/account/AccountProvider';
import { acceptInvite, previewInvite } from '../services/blend/blendApi';
import type { LibraryStackParamList } from '../types/navigation';

export default function BlendJoinScreen() {
  const { params: { code } } = useRoute<RouteProp<LibraryStackParamList, 'BlendJoin'>>();
  const navigation = useNavigation<NativeStackNavigationProp<LibraryStackParamList>>();
  const account = useAccount();
  const token = useRef(account.token);
  token.current = account.token;
  const [preview, setPreview] = useState<BlendInvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setPreview(null);
    setError(null);
    void previewInvite(code).then(result => {
      if (!current) return;
      if (result.ok === true) setPreview(result.data);
      else setError(result.code === 'expired' ? BLEND_TEXT.expired : result.status === 404 ? BLEND_TEXT.notfound : result.error);
    });
    return () => { current = false; };
  }, [code, attempt]);
  useEffect(() => { setConsent(false); setBusy(false); }, [account.profile?.userId]);
  const join = async () => {
    const joinedWith = token.current;
    if (!joinedWith || busy) return;
    setBusy(true);
    setError(null);
    const result = await acceptInvite(joinedWith, code);
    if (token.current !== joinedWith) return;
    setBusy(false);
    if (result.ok === false) { setError(result.error); return; }
    await AsyncStorage.removeItem('allegra:pending-blend-invite').catch(() => undefined);
    navigation.replace('Blend', { blendId: result.data.id });
  };
  return <SafeAreaView style={s.screen} edges={['top']}>
    <Text style={s.title} accessibilityRole="header">Blend with a friend</Text>
    <View style={s.panel}>
      <Text style={s.panelBody}>{preview ? `${preview.inviterName} invited you to a playlist made from both your tastes.` : error ?? 'Loading the invite…'}</Text>
      {preview?.full ? <Text style={s.note}>{BLEND_TEXT.full}</Text> : preview ? <>
        {account.signedIn ? <Text style={s.note}>Joining as {account.profile?.displayName ?? 'your account'}</Text> : null}
        <Pressable style={s.primary} accessibilityRole="button" onPress={() => account.signedIn ? setConsent(true) : void account.signInWithGoogle()}>
          <Text style={s.primaryText}>{account.signedIn ? 'Join' : 'Sign in to join'}</Text>
        </Pressable>
      </> : error ? <Pressable style={s.primary} accessibilityRole="button" onPress={() => setAttempt(value => value + 1)}><Text style={s.primaryText}>Try again</Text></Pressable> : null}
      {preview && error ? <Text style={s.note} accessibilityRole="alert">{error}</Text> : null}
    </View>
    <ConsentSheet visible={consent} mode="join" inviterName={preview?.inviterName} busy={busy} error={error} onConfirm={() => void join()} onCancel={() => setConsent(false)} />
  </SafeAreaView>;
}
