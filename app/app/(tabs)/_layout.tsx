import { View, Text, StyleSheet, Platform } from 'react-native';

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { Colors } from '@/constants/Design';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ALL_TABS = [
  { name: 'index',        label: 'Lijsten', icon: 'layers',        iconOff: 'layers-outline'        },
  { name: 'agenda',       label: 'Agenda',  icon: 'calendar',      iconOff: 'calendar-outline'      },
  { name: 'habits',       label: 'Habits',  icon: 'trophy',        iconOff: 'trophy-outline'        },
  { name: 'instellingen', label: 'Profiel', icon: 'person-circle', iconOff: 'person-circle-outline' },
] as const;

function TabIcon({ name, focused, label }: { name: IoniconName; focused: boolean; label: string }) {
  const prevFocused = useRef(focused);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    prevFocused.current = focused;
  }, [focused]);

  return (
    <View style={styles.iconCol}>
      <Ionicons name={name} size={19} color={focused ? Colors.yellow : '#666'} />
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.label, focused && styles.labelActive]}>{label}</Text>
    </View>
  );
}

function GlassBar() {
  return (
    <BlurView
      intensity={Platform.OS === 'web' ? 60 : 80}
      tint="dark"
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
        tabBarShowLabel: false,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
        tabBarBackground: () => <GlassBar />,
      }}
    >
      {ALL_TABS.map(({ name, label, icon, iconOff }) => {
        const href = name === 'habits' ? (prefs?.habits_enabled ? '/habits' : null) : undefined;
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
    bottom: Platform.OS === 'web' ? 16 : 32,
    left: 65,
    right: 65,
    marginHorizontal: 12,
    height: 68,
    borderRadius: 34,
    backgroundColor: 'rgba(12,12,12,0.85)',
    borderTopWidth: 0,
    borderWidth: 0.5,
    borderColor: 'rgba(255,255,255,0.10)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.5,
    shadowRadius: 28,
    elevation: 20,
    overflow: 'hidden',
  },
  tabBarItem: {
    height: 68,
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
    gap: 3,
    height: 44,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 8,
    color: '#666',
    letterSpacing: 0,
    textTransform: 'uppercase',
  },
  labelActive: {
    color: Colors.yellow,
  },
});
