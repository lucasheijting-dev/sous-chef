import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius } from '@/constants/Design';

function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    ).start();
  }, []);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return <Animated.View style={[{ opacity }, style]} />;
}

export function SkeletonListCard() {
  return (
    <View style={styles.card}>
      <SkeletonBlock style={styles.emojiBox} />
      <View style={styles.textCol}>
        <SkeletonBlock style={styles.titleLine} />
        <SkeletonBlock style={styles.subtitleLine} />
      </View>
    </View>
  );
}

export function SkeletonNoteCard() {
  return (
    <View style={styles.noteCard}>
      <SkeletonBlock style={styles.noteTitleLine} />
      <SkeletonBlock style={styles.noteLine2} />
      <SkeletonBlock style={styles.noteLine3} />
    </View>
  );
}

export function SkeletonHabitCard() {
  return (
    <View style={styles.habitCard}>
      <SkeletonBlock style={styles.habitTitle} />
      <View style={styles.levelRow}>
        {[0, 1, 2].map(i => <SkeletonBlock key={i} style={styles.levelBtn} />)}
      </View>
    </View>
  );
}

const BASE_BG = Colors.gray100;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 14,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  emojiBox: { width: 50, height: 50, borderRadius: Radius.md, backgroundColor: BASE_BG, marginRight: 14 },
  textCol: { flex: 1, gap: 8 },
  titleLine: { height: 16, width: '60%', borderRadius: 6, backgroundColor: BASE_BG },
  subtitleLine: { height: 12, width: 80, borderRadius: 6, backgroundColor: BASE_BG },
  noteCard: {
    flex: 1,
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 16,
    minHeight: 120,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  noteTitleLine: { height: 15, width: 120, borderRadius: 6, backgroundColor: BASE_BG },
  noteLine2: { height: 12, width: 160, borderRadius: 6, backgroundColor: BASE_BG },
  noteLine3: { height: 12, width: 110, borderRadius: 6, backgroundColor: BASE_BG },
  habitCard: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    padding: 16,
    marginBottom: 12,
    gap: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  habitTitle: { height: 20, width: '50%', borderRadius: 6, backgroundColor: BASE_BG },
  levelRow: { flexDirection: 'row', gap: 8 },
  levelBtn: { flex: 1, height: 52, borderRadius: Radius.md, backgroundColor: BASE_BG },
});
