import { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius } from '@/constants/Design';

type ToastType = 'success' | 'error' | 'info';

type Props = {
  message: string;
  type?: ToastType;
  visible: boolean;
  onHide: () => void;
};

const CONFIG: Record<ToastType, { icon: React.ComponentProps<typeof Ionicons>['name']; color: string }> = {
  success: { icon: 'checkmark-circle', color: '#22c55e' },
  error:   { icon: 'alert-circle',     color: '#ef4444' },
  info:    { icon: 'information-circle', color: Colors.yellow },
};

export function Toast({ message, type = 'success', visible, onHide }: Props) {
  const translateY = useRef(new Animated.Value(100)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.parallel([
          Animated.timing(translateY, { toValue: 100, duration: 250, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }),
        ]).start(() => onHide());
      }, 2200);

      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  const { icon, color } = CONFIG[type];

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }], opacity }]}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

// Convenience hook for showing toasts
import { useState, useCallback } from 'react';

export function useToast() {
  const [state, setState] = useState<{ message: string; type: ToastType; visible: boolean }>({
    message: '',
    type: 'success',
    visible: false,
  });

  const show = useCallback((message: string, type: ToastType = 'success') => {
    setState({ message, type, visible: true });
  }, []);

  const hide = useCallback(() => {
    setState(s => ({ ...s, visible: false }));
  }, []);

  return { toastProps: { ...state, onHide: hide }, show };
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 160,
    left: 24,
    right: 24,
    backgroundColor: Colors.black,
    borderRadius: Radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 10,
    zIndex: 999,
  },
  text: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: Colors.white,
    flex: 1,
  },
});
