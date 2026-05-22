import { useEffect, useRef, useState } from 'react';
import { Animated, Text, StyleSheet, AppState } from 'react-native';
import { Colors } from '@/constants/Design';

async function checkOnline(): Promise<boolean> {
  try {
    const res = await fetch('https://1.1.1.1', { method: 'HEAD', cache: 'no-cache' });
    return res.ok;
  } catch {
    return false;
  }
}

export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  const slideY = useRef(new Animated.Value(-40)).current;

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;

    async function check() {
      const online = await checkOnline();
      setOffline(!online);
    }

    check();
    interval = setInterval(check, 10000);

    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') check();
    });

    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, []);

  useEffect(() => {
    Animated.spring(slideY, {
      toValue: offline ? 0 : -40,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [offline]);

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideY }] }]} pointerEvents="none">
      <Text style={styles.text}>Geen verbinding · Data kan verouderd zijn</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    alignItems: 'center',
  },
  text: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Colors.white,
    letterSpacing: 0.2,
  },
});
