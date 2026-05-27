import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
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
const DEV_PIN = '2409';

function formatDutchNumber(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0')) digits = '31' + digits.slice(1);
  if (!digits.startsWith('31')) return raw;
  const local = digits.slice(2);
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
  return digits.startsWith('31') && digits.length >= 11;
}

export default function SetupScreen() {
  const { setWhatsAppNumber, requestOTP, verifyOTP } = useUser();
  const router = useRouter();

  // Step 1: phone number
  const [display, setDisplay] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Step 2: OTP
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [normalizedPhone, setNormalizedPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const otpInputRef = useRef<TextInput>(null);

  useEffect(() => {
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  function startCooldown() {
    setResendCooldown(30);
    cooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  }

  function handleChangeText(text: string) {
    if (text.length < display.length) { setDisplay(text); return; }
    setDisplay(formatDutchNumber(text));
    setError('');
  }

  async function handleRequestOTP() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const phone = normalizeNumber(display);

    // Dev shortcut
    if (display === DEV_PIN) {
      await setWhatsAppNumber(DEV_PIN);
      router.replace('/onboarding');
      return;
    }

    if (!isValidNumber(display)) return;
    setLoading(true);
    setError('');

    const result = await requestOTP(phone);
    setLoading(false);

    if (result.ok) {
      setNormalizedPhone(phone);
      setStep('otp');
      startCooldown();
      setTimeout(() => otpInputRef.current?.focus(), 300);
    } else {
      setError(result.error ?? 'Onbekende fout. Probeer opnieuw.');
    }
  }

  async function handleVerifyOTP() {
    if (otp.length !== 6) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setOtpLoading(true);
    setOtpError('');

    const result = await verifyOTP(normalizedPhone, otp);
    setOtpLoading(false);

    if (result.ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/onboarding');
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setOtpError(result.error ?? 'Onjuiste code. Probeer opnieuw.');
      setOtp('');
    }
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setOtpError('');
    const result = await requestOTP(normalizedPhone);
    if (result.ok) startCooldown();
    else setOtpError(result.error ?? 'Kon geen code sturen.');
  }

  const valid = isValidNumber(display);

  if (step === 'otp') {
    return (
      <LinearGradient colors={['#0A0A0A', '#1C1C1C']} style={styles.gradient}>
        <StatusBar barStyle="light-content" />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={styles.inner}>
            <View style={styles.logoRow}>
              <Image source={require('@/assets/images/logo.jpg')} style={styles.logoBox} />
            </View>
            <Image source={require('@/assets/images/tekstsouschef.png')} style={styles.title} resizeMode="contain" />

            <View style={styles.otpCard}>
              <View style={styles.otpIconRow}>
                <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
                <Text style={styles.otpSentText}>Code verstuurd via WhatsApp</Text>
              </View>
              <Text style={styles.otpSubtext}>
                Voer de 6-cijferige code in die je hebt ontvangen op{'\n'}
                <Text style={styles.otpPhone}>+{normalizedPhone}</Text>
              </Text>
            </View>

            <View style={[styles.inputWrapper, otp.length === 6 && styles.inputWrapperValid]}>
              <TextInput
                ref={otpInputRef}
                style={[styles.input, styles.otpInput]}
                value={otp}
                onChangeText={t => { setOtp(t.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                placeholder="123456"
                placeholderTextColor="#555"
                keyboardType="number-pad"
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleVerifyOTP}
                selectionColor={Colors.yellow}
                maxLength={6}
              />
              {otp.length === 6 && (
                <View style={styles.checkmark}>
                  <Ionicons name="checkmark-circle" size={22} color={Colors.yellow} />
                </View>
              )}
            </View>

            {otpError ? <Text style={styles.errorText}>{otpError}</Text> : null}

            <TouchableOpacity onPress={handleVerifyOTP} disabled={otp.length !== 6 || otpLoading} activeOpacity={0.85}>
              <LinearGradient
                colors={otp.length === 6 ? ['#FCC10C', '#E5A800'] : ['#333', '#333']}
                style={styles.button}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                {otpLoading
                  ? <ActivityIndicator color="#0A0A0A" />
                  : <Text style={[styles.buttonText, otp.length !== 6 && styles.buttonTextDisabled]}>Bevestigen</Text>
                }
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.resendRow}>
              <TouchableOpacity onPress={handleResend} disabled={resendCooldown > 0} activeOpacity={0.7}>
                <Text style={[styles.resendText, resendCooldown > 0 && styles.resendDisabled]}>
                  {resendCooldown > 0 ? `Opnieuw sturen (${resendCooldown}s)` : 'Geen code ontvangen? Opnieuw sturen'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setStep('phone'); setOtp(''); setOtpError(''); }} activeOpacity={0.7} style={{ marginTop: 12 }}>
                <Text style={styles.backText}>← Ander nummer</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </LinearGradient>
    );
  }

  return (
    <LinearGradient colors={['#0A0A0A', '#1C1C1C']} style={styles.gradient}>
      <StatusBar barStyle="light-content" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.inner}>
          <View style={styles.logoRow}>
            <Image source={require('@/assets/images/logo.jpg')} style={styles.logoBox} />
          </View>
          <Image source={require('@/assets/images/tekstsouschef.png')} style={styles.title} resizeMode="contain" />
          <Text style={styles.subtitle}>Jouw persoonlijke assistent via WhatsApp</Text>

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
              onSubmitEditing={handleRequestOTP}
              selectionColor={Colors.yellow}
            />
            {valid && (
              <View style={styles.checkmark}>
                <Ionicons name="checkmark-circle" size={22} color={Colors.yellow} />
              </View>
            )}
          </View>

          {error ? <Text style={styles.errorText}>{error}</Text> : null}

          <TouchableOpacity onPress={handleRequestOTP} disabled={!valid || loading} activeOpacity={0.85}>
            <LinearGradient
              colors={valid ? ['#FCC10C', '#E5A800'] : ['#333', '#333']}
              style={styles.button}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              {loading
                ? <ActivityIndicator color="#0A0A0A" />
                : <Text style={[styles.buttonText, !valid && styles.buttonTextDisabled]}>Inlogcode sturen</Text>
              }
            </LinearGradient>
          </TouchableOpacity>

          <View style={styles.stepsBox}>
            <Text style={styles.stepsTitle}>Hoe werkt het?</Text>
            {[
              { n: '1', t: 'Vul je WhatsApp-nummer in met landcode (bijv. +31 6 12345678)' },
              { n: '2', t: 'Je ontvangt een 6-cijferige inlogcode via WhatsApp' },
              { n: '3', t: 'Voer de code in en je bent verbonden' },
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
  inner: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  logoRow: { marginBottom: 20 },
  logoBox: { width: 80, height: 80, borderRadius: 24 },
  title: { width: 200, height: 48, marginBottom: 8 },
  subtitle: { fontFamily: 'Inter_300Light', fontSize: 15, color: '#888', textAlign: 'center', marginBottom: 20, lineHeight: 22 },
  botCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#0D2318', borderRadius: Radius.md, padding: 14,
    width: '100%', borderWidth: 1, borderColor: '#1A3D24', marginBottom: 16,
  },
  botCardBody: { flex: 1 },
  botCardLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: '#888', marginBottom: 3 },
  botNumber: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#25D366' },
  inputWrapper: {
    width: '100%', marginBottom: 8, borderRadius: Radius.md, borderWidth: 1,
    borderColor: '#2A2A2A', backgroundColor: '#161616', overflow: 'hidden',
    flexDirection: 'row', alignItems: 'center',
  },
  inputWrapperValid: { borderColor: Colors.yellow + '60' },
  input: { flex: 1, paddingHorizontal: 18, paddingVertical: 16, fontSize: 16, fontFamily: 'Inter_400Regular', color: '#FFFFFF' },
  otpInput: { textAlign: 'center', fontSize: 28, letterSpacing: 8, fontFamily: 'Inter_700Bold' },
  checkmark: { paddingRight: 14 },
  errorText: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#FF6B6B', marginBottom: 10, textAlign: 'center' },
  button: { width: '100%', borderRadius: Radius.pill, paddingVertical: 17, paddingHorizontal: 40, alignItems: 'center', marginBottom: 16, minWidth: 280 },
  buttonText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#0A0A0A', letterSpacing: 0.2 },
  buttonTextDisabled: { color: '#555' },
  stepsBox: { width: '100%', marginTop: 4, backgroundColor: '#161616', borderRadius: Radius.md, padding: 18, borderWidth: 1, borderColor: '#2A2A2A' },
  stepsTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: '#555', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 14 },
  step: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 12 },
  stepNum: { width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.yellow, justifyContent: 'center', alignItems: 'center', marginTop: 1, flexShrink: 0 },
  stepNumText: { fontFamily: 'Inter_700Bold', fontSize: 11, color: Colors.black },
  stepText: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#888', lineHeight: 19, flex: 1 },
  // OTP step
  otpCard: { width: '100%', backgroundColor: '#0D2318', borderRadius: Radius.md, padding: 16, borderWidth: 1, borderColor: '#1A3D24', marginBottom: 20 },
  otpIconRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  otpSentText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#25D366' },
  otpSubtext: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#888', lineHeight: 20 },
  otpPhone: { fontFamily: 'Inter_600SemiBold', color: '#FFFFFF' },
  resendRow: { alignItems: 'center', gap: 4 },
  resendText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.yellow },
  resendDisabled: { color: '#555' },
  backText: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#555' },
});
