import { useState } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useUser } from '@/context/UserContext';
import { Colors, Radius } from '@/constants/Design';

export default function SetupScreen() {
  const { setWhatsAppNumber } = useUser();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleConnect() {
    const cleaned = value.trim();
    if (!cleaned) return;
    setLoading(true);
    const found = await setWhatsAppNumber(cleaned);
    setLoading(false);
    if (!found) {
      Alert.alert(
        'Verbinding mislukt',
        'Controleer je nummer en probeer opnieuw. Zorg dat je een internetverbinding hebt.',
      );
    }
  }

  return (
    <LinearGradient colors={['#0A0A0A', '#1C1C1C']} style={styles.gradient}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.inner}>
          <View style={styles.logoRow}>
            <LinearGradient
              colors={['#FFD60A', '#FFAA00']}
              style={styles.logoBox}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Text style={styles.logoEmoji}>🍳</Text>
            </LinearGradient>
          </View>

          <Text style={styles.title}>Sous-Chef</Text>
          <Text style={styles.subtitle}>Jouw persoonlijke assistent via WhatsApp</Text>

          <View style={styles.inputWrapper}>
            <TextInput
              style={styles.input}
              value={value}
              onChangeText={setValue}
              placeholder="+31 6 12345678"
              placeholderTextColor="#555"
              keyboardType="default"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleConnect}
              selectionColor={Colors.yellow}
            />
          </View>

          <TouchableOpacity
            onPress={handleConnect}
            disabled={!value.trim() || loading}
            activeOpacity={0.85}
          >
            <LinearGradient
              colors={value.trim() ? ['#FFD60A', '#FFAA00'] : ['#333', '#333']}
              style={styles.button}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={[styles.buttonText, !value.trim() && styles.buttonTextDisabled]}>
                  Verbinden
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {/* Rule #4: intuitive navigation — step-by-step hint */}
        <View style={styles.stepsBox}>
          <Text style={styles.stepsTitle}>Hoe werkt het?</Text>
          {[
            { n: '1', t: 'Stuur een bericht via WhatsApp naar het bot-nummer' },
            { n: '2', t: 'Vul hier je WhatsApp-nummer in (met landcode)' },
            { n: '3', t: 'Klaar — de app synct automatisch' },
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoEmoji: { fontSize: 40 },
  title: {
    fontFamily: 'Inter_700Bold',
    fontSize: 36,
    color: '#FFFFFF',
    marginBottom: 8,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontFamily: 'Inter_300Light',
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginBottom: 40,
    lineHeight: 22,
  },
  inputWrapper: {
    width: '100%',
    marginBottom: 14,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#2A2A2A',
    backgroundColor: '#161616',
    overflow: 'hidden',
  },
  input: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    fontFamily: 'Inter_400Regular',
    color: '#FFFFFF',
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
