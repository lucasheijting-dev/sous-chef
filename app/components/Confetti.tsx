import { useEffect, useRef } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

const { width, height } = Dimensions.get('window');

const COLORS = ['#FCC10C', '#FF6B6B', '#4ECDC4', '#45B7D1', '#DDA0DD', '#96CEB4'];
const PARTICLE_COUNT = 50;

type Particle = {
  x: Animated.Value;
  y: Animated.Value;
  opacity: Animated.Value;
  rotate: Animated.Value;
  color: string;
  size: number;
  startX: number;
};

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, (_, i) => ({
    x: new Animated.Value(0),
    y: new Animated.Value(0),
    opacity: new Animated.Value(0),
    rotate: new Animated.Value(0),
    color: COLORS[i % COLORS.length],
    size: 6 + Math.random() * 8,
    startX: Math.random() * width,
  }));
}

export default function Confetti({ active }: { active: boolean }) {
  const particles = useRef<Particle[]>(createParticles());

  useEffect(() => {
    if (!active) return;

    const animations = particles.current.map((p, i) => {
      p.x.setValue(0);
      p.y.setValue(0);
      p.opacity.setValue(0);
      p.rotate.setValue(0);

      const delay = i * 30;
      const duration = 1800 + Math.random() * 1200;
      const xDrift = (Math.random() - 0.5) * 120;

      return Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(p.opacity, { toValue: 1, duration: 100, useNativeDriver: true }),
          Animated.timing(p.y, { toValue: height + 50, duration, useNativeDriver: true }),
          Animated.timing(p.x, { toValue: xDrift, duration, useNativeDriver: true }),
          Animated.timing(p.rotate, { toValue: 4, duration, useNativeDriver: true }),
          Animated.sequence([
            Animated.delay(duration - 400),
            Animated.timing(p.opacity, { toValue: 0, duration: 400, useNativeDriver: true }),
          ]),
        ]),
      ]);
    });

    Animated.parallel(animations).start();
  }, [active]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.current.map((p, i) => {
        const rotate = p.rotate.interpolate({ inputRange: [0, 4], outputRange: ['0deg', '720deg'] });
        return (
          <Animated.View
            key={i}
            style={{
              position: 'absolute',
              top: -20,
              left: p.startX,
              width: p.size,
              height: p.size,
              borderRadius: 2,
              backgroundColor: p.color,
              opacity: p.opacity,
              transform: [{ translateX: p.x }, { translateY: p.y }, { rotate }],
            }}
          />
        );
      })}
    </View>
  );
}
