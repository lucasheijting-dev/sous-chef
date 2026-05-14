import { useEffect } from 'react';
import {
  Inter_300Light,
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import 'react-native-reanimated';

import '@/lib/geoAlert'; // registers background task before any component renders

import { UserProvider, useUser } from '@/context/UserContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { ModuleSettingsProvider, useModuleSettings } from '@/context/ModuleSettingsContext';

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
        contentStyle: { backgroundColor: colors.offWhite },
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="setup" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="list/[id]" options={{ headerBackTitle: 'Terug' }} />
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

    if (!user && !inSetup) {
      router.replace('/setup');
    } else if (user && !settings.onboarding_done && !inOnboarding && !inSetup) {
      router.replace('/onboarding');
    } else if (user && settings.onboarding_done && (inSetup || inOnboarding)) {
      router.replace('/(tabs)');
    }
  }, [user, userLoading, settings.onboarding_done, settingsLoading, segments]);

  return null;
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    Inter_300Light,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => { if (error) throw error; }, [error]);
  useEffect(() => { if (loaded) SplashScreen.hideAsync(); }, [loaded]);

  if (!loaded) return null;

  return (
    <ThemeProvider>
      <ModuleSettingsProvider>
        <UserProvider>
          <AuthGate />
          <AppStack />
        </UserProvider>
      </ModuleSettingsProvider>
    </ThemeProvider>
  );
}
