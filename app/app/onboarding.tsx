import { useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Animated,
  ScrollView,
  StatusBar,
  Platform,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useModuleSettings, ModuleSettings } from '@/context/ModuleSettingsContext';
import { Colors, Radius } from '@/constants/Design';

const { width } = Dimensions.get('window');

type Preset = 'simple' | 'full' | 'custom';

type StepId = 'welcome' | 'preset' | 'custom' | 'done';

const STEPS: StepId[] = ['welcome', 'preset', 'done'];
const STEPS_CUSTOM: StepId[] = ['welcome', 'preset', 'custom', 'done'];

export default function OnboardingScreen() {
  const router = useRouter();
  const { updateSettings } = useModuleSettings();
  const [step, setStep] = useState<StepId>('welcome');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [custom, setCustom] = useState<Pick<ModuleSettings, 'calendar_mode' | 'habits_mode' | 'notes_enabled'>>({
    calendar_mode: 'full',
    habits_mode: 'full',
    notes_enabled: true,
  });
  const fadeAnim = useRef(new Animated.Value(1)).current;

  function transition(next: StepId) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setStep(next);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }

  async function finish(chosenPreset: Preset, chosenCustom = custom) {
    let patch: Partial<ModuleSettings>;
    if (chosenPreset === 'simple') {
      patch = { calendar_mode: 'lite', habits_mode: 'lite', notes_enabled: false, onboarding_done: true };
    } else if (chosenPreset === 'full') {
      patch = { calendar_mode: 'full', habits_mode: 'full', notes_enabled: true, onboarding_done: true };
    } else {
      patch = { ...chosenCustom, onboarding_done: true };
    }
    await updateSettings(patch);
    router.replace('/(tabs)');
  }

  function handlePreset(p: Preset) {
    setPreset(p);
    if (p === 'custom') {
      transition('custom');
    } else {
      finish(p);
    }
  }

  function handleCustomDone() {
    finish('custom', custom);
  }

  return (
    <LinearGradient colors={['#0A0A0A', '#111']} style={styles.root}>
      <StatusBar barStyle="light-content" />
      <Animated.View style={[styles.content, { opacity: fadeAnim }]}>

        {step === 'welcome' && (
          <View style={styles.center}>
            <Image source={require('@/assets/images/logo.jpg')} style={styles.logoBox} />
            <Text style={styles.title}>Welkom bij{'\n'}Sous-Chef</Text>
            <Text style={styles.subtitle}>
              Jouw persoonlijke assistent voor lijsten, agenda, notities en habits.
            </Text>
            <Text style={styles.hint}>Laten we de app instellen op jouw manier.</Text>
            <TouchableOpacity style={styles.primaryBtn} onPress={() => transition('preset')} activeOpacity={0.85}>
              <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
                <Text style={styles.primaryBtnText}>Aan de slag</Text>
                <Ionicons name="arrow-forward" size={18} color={Colors.black} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}

        {step === 'preset' && (
          <View style={styles.center}>
            <Text style={styles.stepTitle}>Hoe wil je starten?</Text>
            <Text style={styles.stepSub}>Je kunt dit later altijd aanpassen in je profiel.</Text>

            <TouchableOpacity style={styles.optionCard} onPress={() => handlePreset('simple')} activeOpacity={0.85}>
              <View style={styles.optionIcon}><Text style={styles.optionEmoji}>⚡️</Text></View>
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>Simpel</Text>
                <Text style={styles.optionDesc}>Alleen de basis — vandaag's agenda, snelle habits, lijsten.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.optionCard} onPress={() => handlePreset('full')} activeOpacity={0.85}>
              <View style={styles.optionIcon}><Text style={styles.optionEmoji}>🚀</Text></View>
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>Uitgebreid</Text>
                <Text style={styles.optionDesc}>Alle functies — volledige agenda, uitgebreide habits, notities.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.optionCard} onPress={() => handlePreset('custom')} activeOpacity={0.85}>
              <View style={styles.optionIcon}><Text style={styles.optionEmoji}>🎛️</Text></View>
              <View style={styles.optionBody}>
                <Text style={styles.optionTitle}>Zelf kiezen</Text>
                <Text style={styles.optionDesc}>Stel per module in hoe uitgebreid je het wilt.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </TouchableOpacity>
          </View>
        )}

        {step === 'custom' && (
          <ScrollView contentContainerStyle={styles.center} showsVerticalScrollIndicator={false}>
            <Text style={styles.stepTitle}>Kies per module</Text>
            <Text style={styles.stepSub}>Lite = compact & snel. Uitgebreid = alle details.</Text>

            <ModuleRow
              emoji="📅" title="Agenda"
              liteDesc="Alleen vandaag" fullDesc="Volledige planning + kalender"
              value={custom.calendar_mode}
              onChange={v => setCustom(c => ({ ...c, calendar_mode: v }))}
            />
            <ModuleRow
              emoji="🏆" title="Habits"
              liteDesc="Snel afvinken" fullDesc="Streaks, statistieken, week-strip"
              value={custom.habits_mode}
              onChange={v => setCustom(c => ({ ...c, habits_mode: v }))}
            />

            <View style={styles.moduleCard}>
              <View style={styles.moduleHeader}>
                <Text style={styles.moduleEmoji}>📝</Text>
                <Text style={styles.moduleTitle}>Notities</Text>
              </View>
              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.toggleBtn, custom.notes_enabled && styles.toggleBtnActive]}
                  onPress={() => setCustom(c => ({ ...c, notes_enabled: true }))}
                >
                  <Text style={[styles.toggleBtnText, custom.notes_enabled && styles.toggleBtnTextActive]}>Aan</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.toggleBtn, !custom.notes_enabled && styles.toggleBtnActive]}
                  onPress={() => setCustom(c => ({ ...c, notes_enabled: false }))}
                >
                  <Text style={[styles.toggleBtnText, !custom.notes_enabled && styles.toggleBtnTextActive]}>Uit</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.moduleDesc}>
                {custom.notes_enabled ? 'Zichtbaar als tab in Lijsten' : 'Verborgen — WhatsApp werkt nog wel'}
              </Text>
            </View>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleCustomDone} activeOpacity={0.85}>
              <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
                <Text style={styles.primaryBtnText}>Klaar</Text>
                <Ionicons name="checkmark" size={18} color={Colors.black} />
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        )}

      </Animated.View>
    </LinearGradient>
  );
}

function ModuleRow({ emoji, title, liteDesc, fullDesc, value, onChange }: {
  emoji: string; title: string; liteDesc: string; fullDesc: string;
  value: 'lite' | 'full'; onChange: (v: 'lite' | 'full') => void;
}) {
  return (
    <View style={styles.moduleCard}>
      <View style={styles.moduleHeader}>
        <Text style={styles.moduleEmoji}>{emoji}</Text>
        <Text style={styles.moduleTitle}>{title}</Text>
      </View>
      <View style={styles.toggleRow}>
        <TouchableOpacity
          style={[styles.toggleBtn, value === 'lite' && styles.toggleBtnActive]}
          onPress={() => onChange('lite')}
        >
          <Text style={[styles.toggleBtnText, value === 'lite' && styles.toggleBtnTextActive]}>Lite</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.toggleBtn, value === 'full' && styles.toggleBtnActive]}
          onPress={() => onChange('full')}
        >
          <Text style={[styles.toggleBtnText, value === 'full' && styles.toggleBtnTextActive]}>Uitgebreid</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.moduleDesc}>{value === 'lite' ? liteDesc : fullDesc}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { flex: 1 },
  center: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 28, paddingTop: Platform.OS === 'ios' ? 60 : 40, paddingBottom: 60,
    gap: 16,
  },
  logoBox: {
    width: 88, height: 88, borderRadius: 26, marginBottom: 8,
  },
  title: {
    fontFamily: 'Inter_700Bold', fontSize: 36, color: Colors.white,
    textAlign: 'center', letterSpacing: -1, lineHeight: 42,
  },
  subtitle: {
    fontFamily: 'Inter_300Light', fontSize: 15, color: '#888',
    textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },
  hint: {
    fontFamily: 'Inter_400Regular', fontSize: 14, color: '#555',
    textAlign: 'center', marginTop: 8,
  },
  primaryBtn: { width: '100%', marginTop: 8 },
  primaryBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: Radius.pill, paddingVertical: 17,
  },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },

  stepTitle: {
    fontFamily: 'Inter_700Bold', fontSize: 28, color: Colors.white,
    textAlign: 'center', letterSpacing: -0.5,
  },
  stepSub: {
    fontFamily: 'Inter_300Light', fontSize: 14, color: '#666',
    textAlign: 'center', marginBottom: 8,
  },

  optionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: '#161616', borderRadius: Radius.lg,
    padding: 18, width: '100%',
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  optionIcon: {
    width: 46, height: 46, borderRadius: 14,
    backgroundColor: '#222', justifyContent: 'center', alignItems: 'center',
  },
  optionEmoji: { fontSize: 22 },
  optionBody: { flex: 1 },
  optionTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.white, marginBottom: 3 },
  optionDesc: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#666', lineHeight: 18 },

  moduleCard: {
    backgroundColor: '#161616', borderRadius: Radius.lg,
    padding: 18, width: '100%',
    borderWidth: 1, borderColor: '#2A2A2A', gap: 10,
  },
  moduleHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moduleEmoji: { fontSize: 20 },
  moduleTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.white },
  moduleDesc: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#666' },
  toggleRow: { flexDirection: 'row', gap: 8 },
  toggleBtn: {
    flex: 1, paddingVertical: 9, borderRadius: 10,
    backgroundColor: '#222', alignItems: 'center',
    borderWidth: 1, borderColor: '#333',
  },
  toggleBtnActive: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  toggleBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#666' },
  toggleBtnTextActive: { color: Colors.black },
});
