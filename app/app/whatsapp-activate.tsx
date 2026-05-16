import { useState, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Linking,
  Image,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Colors, Radius } from '@/constants/Design';

const BOT_NUMBER = '31684965318';

export default function WhatsAppActivateScreen() {
  const router = useRouter();
  const [opened, setOpened] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleOpenWhatsApp() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Linking.openURL(`whatsapp://send?phone=${BOT_NUMBER}&text=Hoi`);
    setOpened(true);
    timer.current = setTimeout(() => {
      router.replace('/onboarding');
    }, 1500);
  }

  function handleSkip() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (timer.current) clearTimeout(timer.current);
    router.replace('/onboarding');
  }

  return (
    <LinearGradient colors={['#0A0A0A', '#111']} style={styles.gradient}>
      <StatusBar barStyle="light-content" />
      <View style={styles.inner}>
        <Image source={require('@/assets/images/logo.jpg')} style={styles.logo} />

        <Text style={styles.title}>Activeer Sous-Chef</Text>
        <Text style={styles.subtitle}>
          Stuur een berichtje via WhatsApp om te starten. We sturen je alvast een welkomstbericht.
        </Text>

        {opened ? (
          <View style={styles.successCard}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark-circle" size={40} color="#25D366" />
            </View>
            <Text style={styles.successText}>Ga terug naar de app om verder te gaan</Text>
          </View>
        ) : (
          <View style={styles.flowCard}>
            <View style={styles.flowRow}>
              <View style={styles.flowStep}>
                <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
                <Text style={styles.flowLabel}>WhatsApp</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color="#444" />
              <View style={styles.flowStep}>
                <Image source={require('@/assets/images/logo.jpg')} style={styles.flowLogo} />
                <Text style={styles.flowLabel}>Sous-Chef</Text>
              </View>
              <Ionicons name="arrow-forward" size={16} color="#444" />
              <View style={styles.flowStep}>
                <Text style={styles.flowEmoji}>📅</Text>
                <Text style={styles.flowLabel}>iPhone</Text>
              </View>
            </View>
          </View>
        )}

        <TouchableOpacity
          onPress={handleOpenWhatsApp}
          activeOpacity={0.85}
          style={styles.btnWrapper}
        >
          <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.button}>
            <Ionicons name="logo-whatsapp" size={18} color={Colors.black} />
            <Text style={styles.buttonText}>Open WhatsApp</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={handleSkip} style={styles.skipBtn} activeOpacity={0.7}>
          <Text style={styles.skipText}>Verder</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  inner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
    paddingBottom: 60,
    gap: 20,
  },
  logo: {
    width: 88,
    height: 88,
    borderRadius: 26,
    marginBottom: 8,
  },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 32,
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.8,
  },
  subtitle: {
    fontFamily: 'Inter_300Light',
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 300,
  },
  flowCard: {
    backgroundColor: '#161616',
    borderRadius: 20,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
  },
  flowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  flowStep: {
    alignItems: 'center',
    gap: 6,
  },
  flowLogo: {
    width: 28,
    height: 28,
    borderRadius: 8,
  },
  flowEmoji: { fontSize: 24 },
  flowLabel: {
    fontFamily: 'Inter_300Light',
    fontSize: 11,
    color: '#666',
  },
  successCard: {
    backgroundColor: '#0D2318',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1A3D24',
    alignItems: 'center',
    gap: 12,
  },
  successIcon: {},
  successText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
  },
  btnWrapper: { width: '100%' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderRadius: Radius.pill,
    paddingVertical: 17,
  },
  buttonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: Colors.black,
  },
  skipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  skipText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#555',
  },
});
