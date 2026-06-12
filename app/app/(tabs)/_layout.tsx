import { View, StyleSheet, Platform, Animated, Dimensions } from 'react-native';

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { Colors } from '@/constants/Design';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const SCREEN_W = Dimensions.get('window').width;
const TAB_SIDE_MARGIN = 56;
const TAB_W = SCREEN_W - TAB_SIDE_MARGIN * 2;

const ALL_TABS = [
  { name: 'index',        label: 'Lijsten', icon: 'layers',        iconOff: 'layers-outline'        },
  { name: 'agenda',       label: 'Agenda',  icon: 'calendar',      iconOff: 'calendar-outline'      },
  { name: 'habits',       label: 'Habits',  icon: 'trophy',        iconOff: 'trophy-outline'        },
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

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarShowLabel: false, // labels rendered inside TabIcon
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
        tabBarBackground: () => <GlassBar />,
      }}
    >
      {ALL_TABS.map(({ name, label, icon, iconOff }) => {
        // Show habits tab by default until prefs load (null = still loading → show tab)
        const href = name === 'habits' ? (prefs === null || prefs.habits_enabled ? '/habits' : null) : undefined;
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
    bottom: Platform.OS === 'web' ? 16 : 28,
    left: 0,
    right: 0,
    marginHorizontal: TAB_SIDE_MARGIN,
    width: TAB_W,
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
