import { useEffect, useRef } from 'react';
import { Animated, View, StyleSheet, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors, Radius } from '@/constants/Design';

const BASE_BG = Colors.gray100;
const SHIMMER_W = 200;

function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const shimmerX = useRef(new Animated.Value(-SHIMMER_W)).current;

  useEffect(() => {
    Animated.loop(
      Animated.timing(shimmerX, {
        toValue: SHIMMER_W * 4,
        duration: 1400,
        useNativeDriver: true,
      }),
    ).start();
  }, []);

  return (
    <View style={[{ backgroundColor: BASE_BG, overflow: 'hidden' }, style]}>
      <Animated.View
        style={{
          position: 'absolute',
          top: 0, bottom: 0,
          width: SHIMMER_W,
          transform: [{ translateX: shimmerX }],
        }}
      >
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.55)', 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </View>
  );
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
  emojiBox: { width: 50, height: 50, borderRadius: Radius.md, marginRight: 14 },
  textCol: { flex: 1, gap: 8 },
  titleLine: { height: 16, width: '60%', borderRadius: 6 },
  subtitleLine: { height: 12, width: 80, borderRadius: 6 },
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
  noteTitleLine: { height: 15, width: 120, borderRadius: 6 },
  noteLine2: { height: 12, width: 160, borderRadius: 6 },
  noteLine3: { height: 12, width: 110, borderRadius: 6 },
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
  habitTitle: { height: 20, width: '50%', borderRadius: 6 },
  levelRow: { flexDirection: 'row', gap: 8 },
  levelBtn: { flex: 1, height: 52, borderRadius: Radius.md },
});
