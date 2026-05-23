import { View, StyleSheet, Platform } from 'react-native';

import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useEffect } from 'react';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { Colors } from '@/constants/Design';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ALL_TABS = [
  { name: 'index',        label: 'Lijsten', icon: 'layers',        iconOff: 'layers-outline'        },
  { name: 'agenda',       label: 'Agenda',  icon: 'calendar',      iconOff: 'calendar-outline'      },
  { name: 'habits',       label: 'Habits',  icon: 'trophy',        iconOff: 'trophy-outline'        },
  { name: 'instellingen', label: 'Instellingen', icon: 'settings-sharp', iconOff: 'settings-outline' },
] as const;

function TabIcon({ name, focused }: { name: IoniconName; focused: boolean; label: string }) {
  const prevFocused = useRef(focused);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    prevFocused.current = focused;
  }, [focused]);

  return (
    <View style={styles.iconCol}>
      <Ionicons name={name} size={24} color={focused ? Colors.yellow : 'rgba(255,255,255,0.82)'} />
    </View>
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
    left: 50,
    right: 50,
    height: 62,
    borderRadius: 16,
    backgroundColor: '#0A0A0A',
    borderTopWidth: 0,
    borderWidth: 2,
    borderColor: Colors.yellow,
    shadowColor: Colors.yellow,
    shadowOffset: { width: 4, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 0,
    elevation: 8,
  },
  tabBarItem: {
    height: 62,
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
    height: 44,
  },
});
