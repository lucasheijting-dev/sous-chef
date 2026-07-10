import { useEffect, useState } from 'react';
import { Alert, Linking, Modal, Text, TouchableOpacity, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { TitanOne_400Regular } from '@expo-google-fonts/titan-one';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as Updates from 'expo-updates';
import 'react-native-reanimated';

import '@/lib/geoAlert'; // registers background task before any component renders
import '@/lib/pushNotifications'; // registers background push task + notification handler

import { UserProvider, useUser } from '@/context/UserContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { ModuleSettingsProvider, useModuleSettings } from '@/context/ModuleSettingsContext';
import { registerForPushNotifications } from '@/lib/pushNotifications';
import { OfflineBanner } from '@/components/OfflineBanner';
import { MorningScreen } from '@/components/MorningScreen';
import { triggerListRefresh } from '@/lib/listEvents';
import { apiFetch } from '@/lib/api';

SplashScreen.preventAutoHideAsync();

function AppStack() {
  const { colors } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.white },
        headerTitleStyle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black },
        headerShadowVisible: false,
        headerBackTitle: '',
        headerTintColor: colors.black,
        contentStyle: { backgroundColor: colors.offWhite },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="setup" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="whatsapp-activate" options={{ headerShown: false }} />
      <Stack.Screen name="list/[id]" options={{}} />
      <Stack.Screen name="automessages" options={{ title: 'Automatische berichten', headerShown: true }} />
    </Stack>
  );
}

function AuthGate() {
  const { user, isLoading: userLoading } = useUser();
  const { settings, isLoading: settingsLoading } = useModuleSettings();
  const segments = useSegments();
  const router = useRouter();
  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(null);
  const [pendingInviteDetails, setPendingInviteDetails] = useState<{ list_name: string; list_emoji: string; inviter_name: string; expires_at: string } | null>(null);
  const [inviteBanner, setInviteBanner] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);

  useEffect(() => {
    if (userLoading || settingsLoading) return;
    const inSetup = segments[0] === 'setup';
    const inOnboarding = segments[0] === 'onboarding';
    const inWhatsAppActivate = segments[0] === 'whatsapp-activate';
    const inAuthFlow = inSetup || inOnboarding || inWhatsAppActivate;

    if (!user && !inSetup) {
      router.replace('/setup');
    } else if (user && !settings.onboarding_done && !inAuthFlow) {
      router.replace('/onboarding');
    } else if (user && settings.onboarding_done && inAuthFlow) {
      router.replace('/(tabs)');
    }
  }, [user, userLoading, settings.onboarding_done, settingsLoading, segments]);

  // Register for push notifications once the real user is loaded
  useEffect(() => {
    if (user && user.id !== 'dev') {
      registerForPushNotifications(user.id);
    }
  }, [user?.id]);

  // Process pending invite referral
  useEffect(() => {
    if (!user || user.id === 'dev') return;
    AsyncStorage.getItem('pending_invite_from').then(from => {
      if (!from) return;
      AsyncStorage.removeItem('pending_invite_from').catch(() => {});
      apiFetch(`/join/referral?user_id=${user.id}&from=${encodeURIComponent(from)}`, { method: 'POST' })
        .catch(() => {});
    }).catch(() => {});
  }, [user?.id]);

  async function fetchInviteDetails(token: string) {
    try {
      const res = await apiFetch(`/sharing/invite-details?token=${encodeURIComponent(token)}`);
      if (!res.ok) {
        const data = await res.json();
        setInviteBanner({ type: 'error', message: data.error ?? 'Uitnodiging niet gevonden of verlopen' });
        setTimeout(() => setInviteBanner(null), 4000);
        return;
      }
      const details = await res.json();
      setPendingInviteToken(token);
      setPendingInviteDetails(details);
    } catch {
      // silent network error
    }
  }

  async function acceptPendingInvite() {
    if (!pendingInviteToken || !user) return;
    try {
      const res = await apiFetch(`/sharing/accept-invite`, {
        method: 'POST',
        body: JSON.stringify({ token: pendingInviteToken, user_id: user.id }),
      });
      const data = await res.json();
      setPendingInviteToken(null);
      setPendingInviteDetails(null);
      if (res.ok) {
        triggerListRefresh();
        setInviteBanner({ type: 'success', message: `Toegevoegd aan ${data.list_emoji ?? '📝'} ${data.list_name ?? 'de lijst'}!` });
        setTimeout(() => setInviteBanner(null), 5000);
      } else if (res.status === 409) {
        setInviteBanner({ type: 'info', message: 'Je bent al lid van deze lijst.' });
        setTimeout(() => setInviteBanner(null), 3000);
      } else {
        setInviteBanner({ type: 'error', message: data.error ?? 'Uitnodiging mislukt. Probeer het opnieuw.' });
        setTimeout(() => setInviteBanner(null), 4000);
      }
    } catch {
      setInviteBanner({ type: 'error', message: 'Netwerk fout. Probeer het opnieuw.' });
      setTimeout(() => setInviteBanner(null), 4000);
      setPendingInviteToken(null);
      setPendingInviteDetails(null);
    }
  }

  // Process pending list invite (from deep link stored before user was ready)
  useEffect(() => {
    if (!user || user.id === 'dev') return;
    AsyncStorage.getItem('pending_list_invite').then(async token => {
      if (!token) return;
      await AsyncStorage.removeItem('pending_list_invite').catch(() => {});
      fetchInviteDetails(token);
    }).catch(() => {});
  }, [user?.id]);

  // Process list invite deep links that arrive while app is already open
  useEffect(() => {
    if (!user || user.id === 'dev') return;
    function handleLiveDeepLink({ url }: { url: string }) {
      if (url.includes('listInvite')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const token = params.get('listInvite');
        if (token) {
          AsyncStorage.removeItem('pending_list_invite').catch(() => {});
          fetchInviteDetails(token);
        }
      }
    }
    const sub = Linking.addEventListener('url', handleLiveDeepLink);
    return () => sub.remove();
  }, [user?.id]);

  return (
    <>
      <Modal visible={pendingInviteDetails !== null} transparent animationType="slide" onRequestClose={() => { setPendingInviteToken(null); setPendingInviteDetails(null); }}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 28, gap: 16 }}>
            <View style={{ alignItems: 'center', gap: 6 }}>
              <Text style={{ fontSize: 40 }}>{pendingInviteDetails?.list_emoji ?? '📝'}</Text>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: '#000', textAlign: 'center' }}>{pendingInviteDetails?.list_name}</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#666', textAlign: 'center' }}>
                {pendingInviteDetails?.inviter_name} wil deze lijst met je delen
              </Text>
            </View>
            <TouchableOpacity onPress={acceptPendingInvite} style={{ backgroundColor: '#FCC10C', borderRadius: 16, padding: 16, alignItems: 'center' }} activeOpacity={0.85}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: '#000' }}>Accepteer uitnodiging</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setPendingInviteToken(null); setPendingInviteDetails(null); }} style={{ alignItems: 'center', padding: 8 }} activeOpacity={0.7}>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: '#666' }}>Weiger</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      {inviteBanner && (
        <View style={{
          position: 'absolute', top: 60, left: 16, right: 16, zIndex: 9999,
          backgroundColor: inviteBanner.type === 'success' ? '#22C55E' : inviteBanner.type === 'error' ? '#EF4444' : '#3B82F6',
          borderRadius: 14, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 10,
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
        }}>
          <Text style={{ fontSize: 18 }}>{inviteBanner.type === 'success' ? '✅' : inviteBanner.type === 'error' ? '❌' : 'ℹ️'}</Text>
          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff', flex: 1 }}>{inviteBanner.message}</Text>
          <TouchableOpacity onPress={() => setInviteBanner(null)}>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 18, lineHeight: 20 }}>×</Text>
          </TouchableOpacity>
        </View>
      )}
    </>
  );
}

async function checkForOTAUpdate() {
  if (__DEV__) return;
  try {
    const update = await Updates.checkForUpdateAsync();
    if (update.isAvailable) {
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    }
  } catch {
    // silent — no network or not an EAS build
  }
}

const CALENDAR_PROVIDER_NAMES: Record<string, string> = {
  google:  'Google Calendar',
  outlook: 'Microsoft Outlook',
  iphone:  'iPhone Agenda',
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
    TitanOne_400Regular,
  });

  useEffect(() => { checkForOTAUpdate(); }, []);

  useEffect(() => {
    function handleDeepLink({ url }: { url: string }) {
      if (url.includes('calendar-connected')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        if (params.get('error')) {
          Alert.alert('Koppeling mislukt', 'De agenda-koppeling is niet gelukt. Probeer het opnieuw.');
        } else {
          const provider = params.get('provider') ?? '';
          const name = CALENDAR_PROVIDER_NAMES[provider] ?? 'Agenda';
          Alert.alert('Gekoppeld!', `${name} is succesvol gekoppeld. Je afspraken worden gesynchroniseerd.`);
        }
      } else if (url.includes('listInvite')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const token = params.get('listInvite');
        if (token) AsyncStorage.setItem('pending_list_invite', token).catch(() => {});
      } else if (url.includes('invite')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const from = params.get('from');
        if (from) {
          AsyncStorage.setItem('pending_invite_from', from).catch(() => {});
        }
      }
    }
    const sub = Linking.addEventListener('url', handleDeepLink);
    // Also check the initial URL (app launched via deep link)
    Linking.getInitialURL().then(url => {
      if (!url) return;
      if (url.includes('listInvite')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const token = params.get('listInvite');
        if (token) AsyncStorage.setItem('pending_list_invite', token).catch(() => {});
      } else if (url.includes('invite')) {
        const params = new URLSearchParams(url.split('?')[1] ?? '');
        const from = params.get('from');
        if (from) AsyncStorage.setItem('pending_invite_from', from).catch(() => {});
      }
    }).catch(() => {});
    return () => sub.remove();
  }, []);
  useEffect(() => { if (error) throw error; }, [error]);

  // Handle notification tap → navigate to relevant screen
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as Record<string, any>;
      if (data?.type === 'deep_work_reminder') {
        const duration = data.duration ?? 90;
        AsyncStorage.setItem('deep_work_prefill_minutes', String(duration)).catch(() => {});
      }
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (loaded) { SplashScreen.hideAsync(); return; }
    // Fallback: hide splash after 5s even if fonts are still loading (Android/slow networks)
    const t = setTimeout(() => SplashScreen.hideAsync(), 5000);
    return () => clearTimeout(t);
  }, [loaded]);

  if (!loaded) return null;

  return (
    <ThemeProvider>
      <ModuleSettingsProvider>
        <UserProvider>
          <AuthGate />
          <AppStack />
          <OfflineBanner />
          <MorningScreen />
        </UserProvider>
      </ModuleSettingsProvider>
    </ThemeProvider>
  );
}
