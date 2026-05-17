import { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
  Animated,
  ScrollView,
  StatusBar,
  Platform,
  TextInput,
  Alert,
  Linking,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useModuleSettings, ModuleSettings } from '@/context/ModuleSettingsContext';
import { useTheme, ThemeMode } from '@/context/ThemeContext';
import { useUser } from '@/context/UserContext';
import { startGeoAlertTask } from '@/lib/geoAlert';
import { Colors, Radius } from '@/constants/Design';
import Confetti from '@/components/Confetti';

type Preset = 'simple' | 'full' | 'custom';
type StepId = 'welcome' | 'name' | 'theme' | 'preset' | 'custom' | 'caldav' | 'geo' | 'done';

const ALL_STEPS: StepId[] = ['welcome', 'name', 'theme', 'preset', 'caldav', 'geo', 'done'];
const CUSTOM_STEPS: StepId[] = ['welcome', 'name', 'theme', 'preset', 'custom', 'caldav', 'geo', 'done'];

const PROGRESS_STEPS: StepId[] = ['name', 'theme', 'preset', 'caldav', 'geo'];
const STORAGE_KEY = 'onboarding_step';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

export default function OnboardingScreen() {
  const router = useRouter();
  const { updateSettings } = useModuleSettings();
  const { themeMode, setThemeMode } = useTheme();
  const { user } = useUser();

  const [step, setStep] = useState<StepId>('welcome');
  const [preset, setPreset] = useState<Preset | null>(null);
  const [custom, setCustom] = useState<Pick<ModuleSettings, 'calendar_mode' | 'habits_mode' | 'notes_enabled'>>({
    calendar_mode: 'full',
    habits_mode: 'full',
    notes_enabled: true,
  });
  const [userName, setUserName] = useState('');
  const [geoEnabled, setGeoEnabled] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Load persisted step on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(saved => {
      if (saved && saved !== 'done') {
        setStep(saved as StepId);
      }
    });
  }, []);

  // Persist step on change
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, step);
  }, [step]);

  function transition(next: StepId, direction: 'forward' | 'back' = 'forward') {
    const outX = direction === 'forward' ? -30 : 30;
    const inX = direction === 'forward' ? 30 : -30;
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: outX, duration: 140, useNativeDriver: true }),
    ]).start(() => {
      setStep(next);
      slideAnim.setValue(inX);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      ]).start();
    });
  }

  function getStepList(): StepId[] {
    return preset === 'custom' ? CUSTOM_STEPS : ALL_STEPS;
  }

  function goBack() {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const steps = getStepList();
    const idx = steps.indexOf(step);
    if (idx > 0) transition(steps[idx - 1], 'back');
  }

  function goNext() {
    const steps = getStepList();
    const idx = steps.indexOf(step);
    if (idx < steps.length - 1) transition(steps[idx + 1]);
  }

  function getProgressIndex(): number {
    return PROGRESS_STEPS.indexOf(step);
  }

  async function finish(chosenPreset: Preset, chosenCustom = custom) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    let patch: Partial<ModuleSettings>;
    if (chosenPreset === 'simple') {
      patch = { calendar_mode: 'lite', habits_mode: 'lite', notes_enabled: false };
    } else if (chosenPreset === 'full') {
      patch = { calendar_mode: 'full', habits_mode: 'full', notes_enabled: true };
    } else {
      patch = { ...chosenCustom };
    }
    await updateSettings({ ...patch, onboarding_done: true, user_name: userName });
    await AsyncStorage.removeItem(STORAGE_KEY);
    router.replace('/(tabs)');
  }

  function handlePreset(p: Preset) {
    setPreset(p);
    if (p === 'custom') {
      transition('custom');
    } else {
      transition('caldav');
    }
  }

  const showBack = step !== 'welcome' && step !== 'done';
  const showSkip = ['name', 'theme', 'caldav', 'geo'].includes(step);
  const progressIndex = getProgressIndex();
  const showProgress = progressIndex >= 0;

  return (
    <LinearGradient colors={['#0A0A0A', '#111']} style={styles.root}>
      <StatusBar barStyle="light-content" />

      {/* Header controls */}
      <View style={styles.header}>
        {showBack ? (
          <TouchableOpacity onPress={goBack} style={styles.backBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={24} color="#666" />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}

        {showProgress && (
          <View style={styles.progressBar}>
            {PROGRESS_STEPS.map((_, i) => (
              <View
                key={i}
                style={[styles.progressDot, i <= progressIndex && styles.progressDotActive]}
              />
            ))}
          </View>
        )}

        {showSkip ? (
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              goNext();
            }}
            style={styles.skipBtn}
          >
            <Text style={styles.skipText}>Sla over</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerSpacer} />
        )}
      </View>

      <Animated.View style={[styles.content, { opacity: fadeAnim, transform: [{ translateX: slideAnim }] }]}>
        {step === 'welcome' && <WelcomeStep onNext={() => transition('name')} />}
        {step === 'name' && (
          <NameStep
            value={userName}
            onChange={setUserName}
            onNext={() => { transition('theme'); }}
          />
        )}
        {step === 'theme' && (
          <ThemeStep
            themeMode={themeMode}
            onSelect={setThemeMode}
            onNext={() => transition('preset')}
          />
        )}
        {step === 'preset' && <PresetStep onSelect={handlePreset} />}
        {step === 'custom' && (
          <CustomStep
            custom={custom}
            setCustom={setCustom}
            onNext={() => transition('caldav')}
          />
        )}
        {step === 'caldav' && (
          <CaldavStep
            userId={user?.id ?? null}
            onNext={() => transition('geo')}
          />
        )}
        {step === 'geo' && (
          <GeoStep
            userId={user?.id ?? null}
            geoEnabled={geoEnabled}
            setGeoEnabled={setGeoEnabled}
            onNext={() => transition('done')}
          />
        )}
        {step === 'done' && (
          <DoneStep
            userName={userName}
            preset={preset ?? 'full'}
            onFinish={() => finish(preset ?? 'full', custom)}
          />
        )}
      </Animated.View>
    </LinearGradient>
  );
}

// ── Step components ────────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <View style={styles.center}>
      <Image source={require('@/assets/images/logo.jpg')} style={styles.logoBox} />
      <Text style={styles.title}>Welkom bij{'\n'}Sous-Chef</Text>
      <Text style={styles.subtitle}>
        Jouw persoonlijke assistent voor lijsten, agenda, notities en habits — allemaal via WhatsApp.
      </Text>
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onNext();
        }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Text style={styles.primaryBtnText}>Aan de slag</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

function NameStep({ value, onChange, onNext }: { value: string; onChange: (v: string) => void; onNext: () => void }) {
  return (
    <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Hoe mag ik je noemen?</Text>
      <Text style={styles.stepSub}>Zodat ik je persoonlijk kan aanspreken.</Text>
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={onChange}
          placeholder="Jouw voornaam"
          placeholderTextColor="#555"
          autoFocus
          returnKeyType="done"
          onSubmitEditing={onNext}
          selectionColor={Colors.yellow}
        />
      </View>
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onNext();
        }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Text style={styles.primaryBtnText}>Volgende</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

const THEME_CARDS: { mode: ThemeMode; emoji: string; label: string; desc: string }[] = [
  { mode: 'dark', emoji: '🌙', label: 'Donker', desc: 'Donkere achtergrond' },
  { mode: 'light', emoji: '☀️', label: 'Licht', desc: 'Lichte achtergrond' },
  { mode: 'system', emoji: '📱', label: 'Systeem', desc: 'Volgt je iPhone instelling' },
];

function ThemeStep({ themeMode, onSelect, onNext }: {
  themeMode: ThemeMode;
  onSelect: (m: ThemeMode) => void;
  onNext: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.stepTitle}>Hoe zie jij de app?</Text>
      <Text style={styles.stepSub}>Je kunt dit later altijd aanpassen.</Text>
      {THEME_CARDS.map(card => (
        <TouchableOpacity
          key={card.mode}
          style={[styles.themeCard, themeMode === card.mode && styles.themeCardActive]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onSelect(card.mode);
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.themeEmoji}>{card.emoji}</Text>
          <View style={styles.themeCardBody}>
            <Text style={styles.themeCardTitle}>{card.label}</Text>
            <Text style={styles.themeCardDesc}>{card.desc}</Text>
          </View>
          {themeMode === card.mode && (
            <Ionicons name="checkmark-circle" size={20} color={Colors.yellow} />
          )}
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={styles.primaryBtn}
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onNext();
        }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Text style={styles.primaryBtnText}>Volgende</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

function PresetStep({ onSelect }: { onSelect: (p: 'simple' | 'full' | 'custom') => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.stepTitle}>Hoe wil je starten?</Text>
      <Text style={styles.stepSub}>Je kunt dit later altijd aanpassen.</Text>

      <TouchableOpacity style={styles.optionCard} onPress={() => onSelect('simple')} activeOpacity={0.85}>
        <View style={styles.optionIcon}><Text style={styles.optionEmoji}>⚡️</Text></View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>Simpel</Text>
          <Text style={styles.optionDesc}>Agenda, lijsten en snelle habits</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#444" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.optionCard} onPress={() => onSelect('full')} activeOpacity={0.85}>
        <View style={styles.optionIcon}><Text style={styles.optionEmoji}>🚀</Text></View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>Uitgebreid</Text>
          <Text style={styles.optionDesc}>Alle functies, volledige planning</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#444" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.optionCard} onPress={() => onSelect('custom')} activeOpacity={0.85}>
        <View style={styles.optionIcon}><Text style={styles.optionEmoji}>🎛️</Text></View>
        <View style={styles.optionBody}>
          <Text style={styles.optionTitle}>Zelf kiezen</Text>
          <Text style={styles.optionDesc}>Stel per module in hoe uitgebreid</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color="#444" />
      </TouchableOpacity>
    </View>
  );
}

function CustomStep({
  custom, setCustom, onNext,
}: {
  custom: Pick<ModuleSettings, 'calendar_mode' | 'habits_mode' | 'notes_enabled'>;
  setCustom: React.Dispatch<React.SetStateAction<Pick<ModuleSettings, 'calendar_mode' | 'habits_mode' | 'notes_enabled'>>>;
  onNext: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.center} showsVerticalScrollIndicator={false}>
      <Text style={styles.stepTitle}>Kies per module</Text>
      <Text style={styles.stepSub}>Simpel = compact & snel. Uitgebreid = alle details.</Text>

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

      <TouchableOpacity style={styles.primaryBtn} onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onNext();
      }} activeOpacity={0.85}>
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Text style={styles.primaryBtnText}>Volgende</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

function CaldavStep({ userId, onNext }: { userId: string | null; onNext: () => void }) {
  function openProfile() {
    if (!userId || userId === 'dev') {
      Alert.alert('Beschikbaar na koppeling', 'Koppel eerst je WhatsApp-nummer.');
      return;
    }
    const url = `${API_BASE}/calendar-profile?userId=${userId}`;
    Linking.openURL(url);
    setTimeout(() => {
      Alert.alert(
        'Profiel gedownload',
        'Ga naar Instellingen → Algemeen → VPN en apparaatbeheer om het profiel te installeren.',
        [{ text: 'Begrepen' }],
      );
    }, 1000);
  }

  return (
    <View style={styles.center}>
      <Text style={styles.stepTitle}>Koppel je iPhone Agenda</Text>
      <Text style={styles.stepSub}>
        Alle WhatsApp-afspraken verschijnen automatisch in je iPhone Agenda.
      </Text>

      <View style={styles.infoCard}>
        <View style={styles.flowRow}>
          <View style={styles.flowStep}>
            <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
            <Text style={styles.flowLabel}>WhatsApp</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color="#444" />
          <View style={styles.flowStep}>
            <Text style={styles.flowEmoji}>👨‍🍳</Text>
            <Text style={styles.flowLabel}>Sous-Chef</Text>
          </View>
          <Ionicons name="arrow-forward" size={14} color="#444" />
          <View style={styles.flowStep}>
            <Text style={styles.flowEmoji}>📅</Text>
            <Text style={styles.flowLabel}>iPhone</Text>
          </View>
        </View>
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        openProfile();
      }} activeOpacity={0.85}>
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Ionicons name="calendar-outline" size={18} color={Colors.black} />
          <Text style={styles.primaryBtnText}>Koppel agenda</Text>
        </LinearGradient>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onNext();
      }} style={styles.laterBtn} activeOpacity={0.7}>
        <Text style={styles.laterText}>Doe dit later</Text>
      </TouchableOpacity>
    </View>
  );
}

function GeoStep({ userId, geoEnabled, setGeoEnabled, onNext }: {
  userId: string | null;
  geoEnabled: boolean;
  setGeoEnabled: (v: boolean) => void;
  onNext: () => void;
}) {
  async function handleToggle(val: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (val && userId && userId !== 'dev') {
      const result = await startGeoAlertTask(userId);
      if (result === 'denied') {
        Alert.alert('Locatie nodig', 'Geef Sous-Chef toegang tot je locatie in de instellingen.');
        return;
      }
    }
    setGeoEnabled(val);
  }

  return (
    <View style={styles.center}>
      <Text style={styles.stepTitle}>Supermarktherinnering</Text>
      <Text style={styles.stepSub}>
        Sous-Chef herkent wanneer je in de buurt van een supermarkt bent en herinnert je aan je boodschappenlijst.
      </Text>

      <TouchableOpacity
        style={[styles.geoToggleCard, geoEnabled && styles.geoToggleCardActive]}
        onPress={() => handleToggle(!geoEnabled)}
        activeOpacity={0.8}
      >
        <View style={styles.geoToggleLeft}>
          <Text style={styles.geoEmoji}>🛒</Text>
          <View>
            <Text style={styles.geoToggleTitle}>{geoEnabled ? 'Ingeschakeld' : 'Uitgeschakeld'}</Text>
            <Text style={styles.geoToggleDesc}>Tik om {geoEnabled ? 'uit' : 'in'} te schakelen</Text>
          </View>
        </View>
        <View style={[styles.toggleIndicator, geoEnabled && styles.toggleIndicatorActive]}>
          <Text style={styles.toggleIndicatorText}>{geoEnabled ? 'AAN' : 'UIT'}</Text>
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={styles.primaryBtn} onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        onNext();
      }} activeOpacity={0.85}>
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Text style={styles.primaryBtnText}>Volgende</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

function DoneStep({ userName, preset, onFinish }: {
  userName: string;
  preset: Preset;
  onFinish: () => void;
}) {
  const examples = preset === 'simple'
    ? ['"tandarts vrijdag 14u"', '"melk op de boodschappenlijst"', '"gesport"']
    : ['"tandarts vrijdag 14u, herinner me eraan"', '"melk en eieren op de boodschappenlijst"', '"20 min gemediteerd"'];

  const greeting = userName.trim()
    ? `Klaar, ${userName.trim()}! 🎉`
    : 'Je bent er klaar voor!';

  return (
    <ScrollView contentContainerStyle={styles.center} showsVerticalScrollIndicator={false}>
      <Confetti active />
      <Text style={styles.doneCheck}>✅</Text>
      <Text style={styles.title}>{greeting}</Text>
      <Text style={styles.subtitle}>
        Stuur berichten via WhatsApp en de app synct automatisch.
      </Text>

      <View style={styles.examplesCard}>
        <Text style={styles.examplesTitle}>Probeer dit</Text>
        {examples.map((ex, i) => (
          <View key={i} style={styles.exampleRow}>
            <Ionicons name="chatbubble-outline" size={14} color="#555" />
            <Text style={styles.exampleText}>{ex}</Text>
          </View>
        ))}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={onFinish} activeOpacity={0.85}>
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.primaryBtnGrad}>
          <Text style={styles.primaryBtnText}>Naar de app</Text>
          <Ionicons name="arrow-forward" size={18} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
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
          <Text style={[styles.toggleBtnText, value === 'lite' && styles.toggleBtnTextActive]}>Simpel</Text>
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 32,
    paddingBottom: 8,
    minHeight: Platform.OS === 'ios' ? 88 : 64,
  },
  backBtn: { padding: 4 },
  headerSpacer: { width: 60 },
  progressBar: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  progressDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2A2A2A',
  },
  progressDotActive: {
    backgroundColor: Colors.yellow,
  },
  skipBtn: { paddingVertical: 6, paddingHorizontal: 8 },
  skipText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#555' },
  content: { flex: 1 },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    paddingTop: 20,
    paddingBottom: 60,
    gap: 16,
  },
  logoBox: { width: 88, height: 88, borderRadius: 26, marginBottom: 8 },
  title: {
    fontFamily: 'TitanOne_400Regular', fontSize: 34, color: Colors.white,
    textAlign: 'center', letterSpacing: 1, lineHeight: 40, textTransform: 'uppercase',
  },
  subtitle: {
    fontFamily: 'Inter_300Light', fontSize: 15, color: '#888',
    textAlign: 'center', lineHeight: 22, maxWidth: 300,
  },
  primaryBtn: { width: '100%', marginTop: 8 },
  primaryBtnGrad: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, borderRadius: Radius.pill, paddingVertical: 17,
  },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },

  stepTitle: {
    fontFamily: 'TitanOne_400Regular', fontSize: 28, color: Colors.white,
    textAlign: 'center', letterSpacing: 1, textTransform: 'uppercase',
  },
  stepSub: {
    fontFamily: 'Inter_300Light', fontSize: 14, color: '#666',
    textAlign: 'center', marginBottom: 8,
  },

  inputWrapper: {
    width: '100%',
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

  themeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#161616',
    borderRadius: Radius.lg,
    padding: 16,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  themeCardActive: {
    borderColor: Colors.yellow + '80',
    backgroundColor: '#1A1600',
  },
  themeEmoji: { fontSize: 24, width: 32, textAlign: 'center' },
  themeCardBody: { flex: 1 },
  themeCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.white, marginBottom: 2 },
  themeCardDesc: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#666' },

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

  infoCard: {
    backgroundColor: '#161616',
    borderRadius: Radius.lg,
    padding: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    alignItems: 'center',
  },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flowStep: { alignItems: 'center', gap: 6 },
  flowEmoji: { fontSize: 22 },
  flowLabel: { fontFamily: 'Inter_300Light', fontSize: 11, color: '#666' },

  laterBtn: { paddingVertical: 10 },
  laterText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#555' },

  geoToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#161616',
    borderRadius: Radius.lg,
    padding: 18,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  geoToggleCardActive: {
    borderColor: Colors.yellow + '60',
    backgroundColor: '#1A1600',
  },
  geoToggleLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  geoEmoji: { fontSize: 24 },
  geoToggleTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.white, marginBottom: 2 },
  geoToggleDesc: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#666' },
  toggleIndicator: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: '#2A2A2A',
  },
  toggleIndicatorActive: { backgroundColor: Colors.yellow },
  toggleIndicatorText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: Colors.black },

  doneCheck: { fontSize: 56, marginBottom: 8 },
  examplesCard: {
    backgroundColor: '#161616',
    borderRadius: Radius.lg,
    padding: 18,
    width: '100%',
    borderWidth: 1,
    borderColor: '#2A2A2A',
    gap: 10,
  },
  examplesTitle: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#555',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  exampleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  exampleText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#888', flex: 1, lineHeight: 20 },
});
