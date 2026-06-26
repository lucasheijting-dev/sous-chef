import { useRef, useCallback } from 'react';
import { View, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function SwipeDeleteRow({
  children,
  onDelete,
  deleteWidth = 72,
  borderRadius = 0,
}: {
  children: React.ReactNode;
  onDelete: () => void;
  deleteWidth?: number;
  borderRadius?: number;
}) {
  const translateX = useRef(new Animated.Value(0)).current;
  const isOpen = useRef(false);

  const close = useCallback(() => {
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, overshootClamping: true }).start();
    isOpen.current = false;
  }, [translateX]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 8 && Math.abs(gs.dx) > Math.abs(gs.dy) * 1.5,
      onPanResponderMove: (_, gs) => {
        const x = isOpen.current
          ? Math.max(gs.dx - deleteWidth, -deleteWidth)
          : Math.min(Math.max(gs.dx, -deleteWidth), 0);
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dx < -36 || (isOpen.current && gs.dx < 0)) {
          Animated.spring(translateX, { toValue: -deleteWidth, useNativeDriver: true, overshootClamping: true }).start();
          isOpen.current = true;
        } else {
          close();
        }
      },
    })
  ).current;

  return (
    <View style={{ overflow: 'hidden', borderRadius }}>
      <View style={{
        position: 'absolute', top: 0, right: 0, bottom: 0, width: deleteWidth,
        backgroundColor: '#EF4444', borderRadius,
        justifyContent: 'center', alignItems: 'center',
      }}>
        <TouchableOpacity
          onPress={() => { close(); setTimeout(onDelete, 150); }}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons name="trash-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
      <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX }] }}>
        {children}
      </Animated.View>
    </View>
  );
}
