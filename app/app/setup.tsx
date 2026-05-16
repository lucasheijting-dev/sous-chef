import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  Alert,
  ActivityIndicator,
  StatusBar,
  Linking,
} from 'react-native';
import { Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useUser } from '@/context/UserContext';
import { Colors, Radius } from '@/constants/Design';

const BOT_NUMBER = '31684965318';
const BOT_DISPLAY = '+31 68 496 5318';

function formatDutchNumber(raw: string): string {
  // Strip everything except digits
  let digits = raw.replace(/\D/g, '');

  // If starts with 0, replace with 31
  if (digits.startsWith('0')) {
    digits = '31' + digits.slice(1);
  }

  // If starts with +31 in raw input, keep digits as-is (already stripped +)
  // digits now starts with 31...

  if (!digits.startsWith('31')) {
    return raw; // Return as-is, user might be typing
  }

  // Format: +31 X XX XX XX XX
  // 31 = country code (2 digits), then up to 9 more digits
  const local = digits.slice(2); // everything after 31

  let formatted = '+31';
  if (local.length > 0) formatted += ' ' + local.slice(0, 1);
  if (local.length > 1) formatted += ' ' + local.slice(1, 3);
  if (local.length > 3) formatted += ' ' + local.slice(3, 5);
  if (local.length > 5) formatted += ' ' + local.slice(5, 7);
  if (local.length > 7) formatted += ' ' + local.slice(7, 9);

  return formatted;
}

function normalizeNumber(formatted: string): string {
  let digits = formatted.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '31' + digits.slice(1);
  return digits;
}

function isValidNumber(formatted: string): boolean {
  const digits = normalizeNumber(formatted);
  // Must be 31 + at least 9 digits = 11+
  return digits.startsWith('31') && digits.length >= 11;
}

export default function SetupScreen() {
  const { setWhatsAppNumber } = useUser();
  const router = useRouter();
  const [display, setDisplay] = useState('');
  const [loading, setLoading] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);
  const slowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (slowTimer.current) clearTimeout(slowTimer.current);
    };
  }, []);

  function handleChangeText(text: string) {
    // Allow user to delete freely — only format when adding
    if (text.length < display.length) {
      setDisplay(text);
      return;
    }
    const formatted = formatDutchNumber(text);
    setDisplay(formatted);
  }

  async function handleConnect() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!isValidNumber(display)) return;

    setLoading(true);
    setSlowLoad(false);

    slowTimer.current = setTimeout(() => setSlowLoad(true), 5000);

    const normalized = normalizeNumber(display);

    try {
      const result = await setWhatsAppNumber(normalized);
      if (slowTimer.current) clearTimeout(slowTimer.current);
      setLoading(false);
      setSlowLoad(false);

      if (result.success) {
        if (result.isNew) {
          router.replace('/whatsapp-activate');
        } else {
          router.replace('/onboarding');
        }
      } else {
        Alert.alert(
          'Verbinding mislukt',
          'Controleer je nummer en probeer opnieuw. Zorg dat je een internetverbinding hebt.',
        );
      }
    } catch {
      if (slowTimer.current) clearTimeout(slowTimer.current);
      setLoading(false);
      setSlowLoad(false);
      Alert.alert(
        'Geen verbinding',
        'Controleer je internetverbinding en probeer opnieuw.',
      );
    }
  }

  const valid = isValidNumber(display);

  return (
    <LinearGradient colors={['#0A0A0A', '#1C1C1C']} style={styles.gradient}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <View style={styles.logoRow}>
            <Image source={require('@/assets/images/logo.jpg')} style={styles.logoBox} />
          </View>

          <Image source={require('@/assets/images/tekstsouschef.png')} style={styles.title} resizeMode="contain" />
          <Text style={styles.subtitle}>Jouw persoonlijke assistent via WhatsApp</Text>

          {/* Bot number card */}
          <View style={styles.botCard}>
            <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
            <View style={styles.botCardBody}>
              <Text style={styles.botCardLabel}>Voeg dit nummer toe als WhatsApp-contact</Text>
              <TouchableOpacity onPress={() => Linking.openURL(`https://wa.me/${BOT_NUMBER}`)}>
                <Text style={styles.botNumber}>{BOT_DISPLAY}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={[styles.inputWrapper, valid && styles.inputWrapperValid]}>
            <TextInput
              style={styles.input}
              value={display}
              onChangeText={handleChangeText}
              placeholder="+31 6 12 34 56 78"
              placeholderTextColor="#555"
              keyboardType="phone-pad"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleConnect}
              selectionColor={Colors.yellow}
            />
            {valid && (
              <View style={styles.checkmark}>
                <Ionicons name="checkmark-circle" size={22} color={Colors.yellow} />
              </View>
            )}
          </View>

          {slowLoad && (
            <Text style={styles.slowText}>Even geduld...</Text>
          )}

          <TouchableOpacity
            onPress={handleConnect}
            disabled={!valid || loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={valid ? ['#FCC10C', '#E5A800'] : ['#333', '#333']}
              style={styles.button}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={[styles.buttonText, !valid && styles.buttonTextDisabled]}>
                  Verbinden
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.stepsBox}>
            <Text style={styles.stepsTitle}>Hoe werkt het?</Text>
            {[
              { n: '1', t: 'Vul je WhatsApp-nummer in met landcode (bijv. +31 6 12345678)' },
              { n: '2', t: 'Je ontvangt een welkomstbericht via WhatsApp' },
              { n: '3', t: 'Klaar — stuur berichten en de app synct automatisch' },
            ].map(({ n, t }) => (
              <View key={n} style={styles.step}>
                <View style={styles.stepNum}>
                  <Text style={styles.stepNumText}>{n}</Text>
                </View>
                <Text style={styles.stepText}>{t}</Text>
              </View>
            ))}
          </View>
        </View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  flex: { flex: 1 },
  inner: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  logoRow: { marginBottom: 20 },
  logoBox: {
    width: 80,
    height: 80,
    borderRadius: 24,
  },
  title: {
    width: 200,
    height: 48,
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: 'Inter_300Light',
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 22,
  },
  botCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#0D2318',
    borderRadius: Radius.md,
    padding: 14,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1A3D24',
    marginBottom: 16,
  },
  botCardBody: { flex: 1 },
  botCardLabel: {
    fontFamily: 'Inter_300Light',
    fontSize: 12,
    color: '#888',
    marginBottom: 3,
  },
  botNumber: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#25D366',
  },
  inputWrapper: {
    width: '100%',
    marginBottom: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#161616',
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputWrapperValid: {
    borderColor: Colors.yellow + '60',
  },
  input: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF',
  },
  checkmark: {
    paddingRight: 14,
  },
  slowText: {
    fontFamily: 'Inter_300Light',
    fontSize: 13,
    color: '#666',
    marginBottom: 10,
    marginTop: -6,
  },
  button: {
    width: '100%',
    borderRadius: Radius.pill,
    paddingVertical: 17,
    paddingHorizontal: 40,
    alignItems: 'center',
    marginBottom: 24,
    minWidth: 280,
  },
  buttonText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
    color: '#0A0A0A',
    letterSpacing: 0.2,
  },
  buttonTextDisabled: { color: '#555' },
  stepsBox: {
    width: '100%',
    marginTop: 4,
    backgroundColor: '#161616',
    borderRadius: Radius.md,
    padding: 18,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  stepsTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 14,
  },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  stepNum: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: Colors.yellow,
    justifyContent: 'center', alignItems: 'center', marginTop: 1,
    flexShrink: 0,
  },
  stepNumText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: Colors.black },
  stepText: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#888', lineHeight: 19, flex: 1 },
});
