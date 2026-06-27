import { View, StyleSheet, Platform, Animated, Dimensions } from 'react-native';

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUser } from '@/context/UserContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { Colors } from '@/constants/Design';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const SCREEN_W = Dimensions.get('window').width;
const MIN_PER_TAB = 62; // minimum px per tab icon before bar starts growing
const DEFAULT_MARGIN = 56;

const ALL_TABS = [
  { name: 'index',        label: 'Lijsten', icon: 'layers',        iconOff: 'layers-outline'        },
  { name: 'agenda',       label: 'Agenda',  icon: 'calendar',      iconOff: 'calendar-outline'      },
  { name: 'habits',       label: 'Habits',  icon: 'trophy',        iconOff: 'trophy-outline'        },
  { name: 'timer',        label: 'Timer',   icon: 'timer',         iconOff: 'timer-outline'         },
  { name: 'instellingen', label: 'Instellingen', icon: 'settings-sharp', iconOff: 'settings-outline' },
] as const;

function TabIcon({ name, focused }: { name: IoniconName; focused: boolean; label: string }) {
  const prevFocused = useRef(focused);
  const glowAnim = useRef(new Animated.Value(focused ? 1 : 0)).current;

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    Animated.timing(glowAnim, { toValue: focused ? 1 : 0, duration: 200, useNativeDriver: true }).start();
    prevFocused.current = focused;
  }, [focused]);

  return (
    <View style={styles.iconCol}>
      <Ionicons name={name} size={24} color={focused ? Colors.yellow : 'rgba(255,255,255,0.55)'} />
      <Animated.View style={[styles.activeDot, { opacity: glowAnim }]} />
    </View>
  );
}

function GlassBar() {
  return (
    <BlurView
      intensity={Platform.OS === 'web' ? 70 : 95}
      tint="systemUltraThinMaterialDark"
      style={StyleSheet.absoluteFill}
    />
  );
}

export default function TabLayout() {
  const { prefs } = useUser();
  const { settings } = useModuleSettings();
  const insets = useSafeAreaInsets();
  const tabBarBottom = (Platform.OS === 'web' ? 16 : 16) + insets.bottom;

  // Grow the pill when more tabs are visible
  const visibleCount = ALL_TABS.filter(({ name }) => {
    if (name === 'habits') return prefs === null || prefs.habits_enabled;
    if (name === 'timer') return settings?.timer_enabled;
    if (name === 'index') return settings?.lists_enabled !== false;
    return true;
  }).length;
  const defaultW = SCREEN_W - DEFAULT_MARGIN * 2;
  const tabW = Math.min(SCREEN_W - 24, Math.max(defaultW, visibleCount * MIN_PER_TAB));
  const tabMargin = (SCREEN_W - tabW) / 2;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: [styles.tabBar, { bottom: tabBarBottom, width: tabW, marginHorizontal: tabMargin }],
        tabBarShowLabel: false, // labels rendered inside TabIcon
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
        tabBarBackground: () => <GlassBar />,
      }}
    >
      {ALL_TABS.map(({ name, label, icon, iconOff }) => {
        // Habits: hidden when explicitly disabled; Timer: hidden when not enabled
        const habitsHref = name === 'habits' ? (prefs === null || prefs.habits_enabled ? ('/habits' as const) : null) : undefined;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const timerHref  = name === 'timer'  ? (settings?.timer_enabled ? ('/timer' as any) : null) : undefined;
        const listsHref  = name === 'index'  ? (settings?.lists_enabled !== false ? ('/' as const) : null) : undefined;
        const href = habitsHref !== undefined ? habitsHref : timerHref !== undefined ? timerHref : listsHref !== undefined ? listsHref : undefined;
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: label,
              href,
              tabBarItemStyle: styles.tabBarItem,
              tabBarIcon: ({ focused }) => (
                <TabIcon
                  name={(focused ? icon : iconOff) as IoniconName}
                  focused={focused}
                  label={label}
                />
              ),
            }}
          />
        );
      })}
      <Tabs.Screen name="notities"   options={{ href: null }} />
      <Tabs.Screen name="bonnetjes"  options={{ href: null }} />

    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 66,
    borderRadius: 33,
    backgroundColor: 'rgba(10,10,10,0.70)',
    borderTopWidth: 0,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 24,
    elevation: 20,
    overflow: 'hidden',
  },
  tabBarItem: {
    height: 66,
    paddingTop: 0,
    paddingBottom: 0,
    paddingHorizontal: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBarIcon: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 0,
    top: 0,
  },
  iconCol: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.yellow,
    marginTop: 3,
    shadowColor: Colors.yellow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
});
