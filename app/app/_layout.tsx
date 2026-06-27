import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
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
      <Stack.Screen name="admin" options={{ title: 'Admin', headerShown: true }} />
    </Stack>
  );
}

function AuthGate() {
  const { user, isLoading: userLoading } = useUser();
  const { settings, isLoading: settingsLoading } = useModuleSettings();
  const segments = useSegments();
  const router = useRouter();

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
      const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';
      fetch(`${API_BASE}/join/referral?user_id=${user.id}&from=${encodeURIComponent(from)}`, { method: 'POST' })
        .catch(() => {});
    }).catch(() => {});
  }, [user?.id]);

  return null;
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
      if (url?.includes('invite')) {
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
