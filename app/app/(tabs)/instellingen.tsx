import { useState } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  TextInput,
  ActivityIndicator,
  Platform,
  Image,
  Linking,
  Modal,
  SafeAreaView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { useTheme, ThemeMode } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { Colors, Radius, Shadow } from '@/constants/Design';

function SettingsRow({
  icon,
  label,
  value,
  right,
  danger,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value?: string;
  right?: React.ReactNode;
  danger?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const inner = (
    <View style={styles.row}>
      <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }, danger && styles.rowIconDanger]}>
        <Ionicons name={icon} size={18} color={danger ? '#EF4444' : colors.black} />
      </View>
      <Text style={[styles.rowLabel, { color: colors.black }, danger && styles.rowLabelDanger]}>{label}</Text>
      {value !== undefined && <Text style={[styles.rowValue, { color: colors.gray400 }]}>{value}</Text>}
      {right}
    </View>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{inner}</TouchableOpacity>;
  }
  return inner;
}

const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { mode: 'system', label: 'Systeem', icon: 'phone-portrait-outline' },
  { mode: 'light',  label: 'Licht',   icon: 'sunny-outline' },
  { mode: 'dark',   label: 'Donker',  icon: 'moon-outline' },
];

const HABITS_EXAMPLES = [
  '"voeg habit toe: mediteren, mini=5min, goed=20min, elite=45min"',
  '"20 min gemediteerd"',
  '"gisteren gesport"',
];

export default function InstellingenTab() {
  const { user, prefs, logout, refreshPrefs } = useUser();
  const { themeMode, setThemeMode, isDark, colors } = useTheme();
  const { settings, updateSetting, updateSettings } = useModuleSettings();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [reminderTime, setReminderTime] = useState(prefs?.habits_reminder_time?.slice(0, 5) ?? '20:00');
  const [habitsModalVisible, setHabitsModalVisible] = useState(false);

  async function toggleHabits(value: boolean) {
    if (!user || user.id === 'dev') return;

    // If enabling and habits_onboarding not done, show modal first
    if (value && !settings.habits_onboarding_done) {
      setHabitsModalVisible(true);
      return;
    }

    setSaving(true);
    await supabase.from('user_prefs').upsert({ user_id: user.id, habits_enabled: value }, { onConflict: 'user_id' });
    await refreshPrefs();
    setSaving(false);
  }

  async function confirmHabitsOnboarding() {
    setHabitsModalVisible(false);
    if (!user || user.id === 'dev') return;
    setSaving(true);
    await supabase.from('user_prefs').upsert({ user_id: user.id, habits_enabled: true }, { onConflict: 'user_id' });
    await refreshPrefs();
    await updateSettings({ habits_onboarding_done: true });
    setSaving(false);
  }

  async function toggleSuggestions(value: boolean) {
    if (!user || user.id === 'dev') return;
    await supabase.from('user_prefs').upsert({ user_id: user.id, suggestions_enabled: value }, { onConflict: 'user_id' });
    await refreshPrefs();
  }

  async function saveReminderTime() {
    if (!user || user.id === 'dev') return;
    if (!reminderTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert('Ongeldig formaat', 'Gebruik HH:MM, bijv. 20:00');
      return;
    }
    await supabase.from('user_prefs').upsert({ user_id: user.id, habits_reminder_time: `${reminderTime}:00` }, { onConflict: 'user_id' });
    await refreshPrefs();
    Alert.alert('✓ Opgeslagen', `Reminder ingesteld op ${reminderTime}`);
  }

  const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

  function openCalendarProfile() {
    if (!user || user.id === 'dev') return;
    const url = `${API_BASE}/calendar-profile?userId=${user.id}`;
    Linking.openURL(url);
    setTimeout(() => {
      Alert.alert(
        'Profiel gedownload',
        'Ga naar Instellingen → Algemeen → VPN en apparaatbeheer en tik op "Sous-Chef" om het profiel te installeren.',
        [{ text: 'Begrepen' }],
      );
    }, 1500);
  }

  function confirmLogout() {
    Alert.alert('Koppeling verwijderen?', 'Je kunt opnieuw koppelen met hetzelfde nummer.', [
      { text: 'Annuleer', style: 'cancel' },
      { text: 'Verwijder', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <>
      <ScrollView style={[styles.container, { backgroundColor: colors.offWhite }]} contentContainerStyle={styles.content}>
        {/* Profile banner */}
        <View style={[styles.banner, { paddingTop: insets.top + 48 }]}>
          <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
          <View style={styles.avatarBox}>
            <Image source={require('@/assets/images/logo.jpg')} style={styles.avatar} />
          </View>
          <Text style={styles.bannerName}>Sous-Chef</Text>
          <Text style={styles.bannerNumber}>{user?.whatsapp_number ?? '—'}</Text>
        </View>

        {/* Habits */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Habits</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="trophy-outline"
            label="Habits tab"
            right={
              saving ? (
                <ActivityIndicator size="small" color={Colors.yellow} />
              ) : (
                <Switch
                  value={prefs?.habits_enabled ?? false}
                  onValueChange={toggleHabits}
                  trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                  thumbColor={Colors.white}
                />
              )
            }
          />
          {prefs?.habits_enabled && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
              <View style={styles.row}>
                <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="notifications-outline" size={18} color={colors.black} />
                </View>
                <Text style={[styles.rowLabel, { color: colors.black }]}>Reminder</Text>
                <TextInput
                  style={[styles.timeInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
                  value={reminderTime}
                  onChangeText={setReminderTime}
                  keyboardType="numbers-and-punctuation"
                  maxLength={5}
                  selectionColor={Colors.yellow}
                />
                <TouchableOpacity onPress={saveReminderTime}>
                  <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.saveBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Text style={styles.saveBtnText}>Opslaan</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        {/* Suggesties */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Suggesties</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="bulb-outline"
            label="Suggesties"
            right={
              <Switch
                value={prefs?.suggestions_enabled ?? true}
                onValueChange={toggleSuggestions}
                trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                thumbColor={Colors.white}
              />
            }
          />
        </View>

        {/* Weergave */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Weergave</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="contrast-outline" size={18} color={colors.black} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.black }]}>Thema</Text>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <View style={styles.themeToggle}>
            {THEME_OPTIONS.map(opt => (
              <TouchableOpacity
                key={opt.mode}
                style={[styles.themeBtn, { backgroundColor: colors.gray100 }, themeMode === opt.mode && styles.themeBtnActive]}
                onPress={() => setThemeMode(opt.mode)}
                activeOpacity={0.7}
              >
                <Ionicons name={opt.icon} size={15} color={themeMode === opt.mode ? Colors.black : colors.gray400} />
                <Text style={[styles.themeBtnLabel, { color: colors.gray400 }, themeMode === opt.mode && styles.themeBtnLabelActive]}>{opt.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Modules */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Modules</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          {/* Calendar */}
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="calendar-outline" size={18} color={colors.black} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.black }]}>Agenda</Text>
            <View style={styles.modeToggle}>
              {(['lite', 'full'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, { backgroundColor: colors.gray100 }, settings.calendar_mode === m && styles.modeBtnActive]}
                  onPress={() => updateSetting('calendar_mode', m)}
                >
                  <Text style={[styles.modeBtnText, { color: colors.gray400 }, settings.calendar_mode === m && styles.modeBtnTextActive]}>
                    {m === 'lite' ? 'Simpel' : 'Uitgebreid'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          {/* Habits */}
          <View style={styles.row}>
            <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="trophy-outline" size={18} color={colors.black} />
            </View>
            <Text style={[styles.rowLabel, { color: colors.black }]}>Habits</Text>
            <View style={styles.modeToggle}>
              {(['lite', 'full'] as const).map(m => (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, { backgroundColor: colors.gray100 }, settings.habits_mode === m && styles.modeBtnActive]}
                  onPress={() => updateSetting('habits_mode', m)}
                >
                  <Text style={[styles.modeBtnText, { color: colors.gray400 }, settings.habits_mode === m && styles.modeBtnTextActive]}>
                    {m === 'lite' ? 'Simpel' : 'Uitgebreid'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          {/* Notes */}
          <SettingsRow
            icon="document-text-outline"
            label="Notities tab"
            right={
              <Switch
                value={settings.notes_enabled}
                onValueChange={v => updateSetting('notes_enabled', v)}
                trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                thumbColor={Colors.white}
              />
            }
          />
        </View>

        {/* Agenda koppelen */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>iPhone Agenda</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="calendar-outline"
            label="Koppel iPhone Agenda"
            value="Installeer profiel"
            onPress={openCalendarProfile}
          />
        </View>

        {/* Koppeling */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="log-out-outline"
            label="Koppeling verwijderen"
            danger
            onPress={confirmLogout}
          />
        </View>
      </ScrollView>

      {/* Habits onboarding modal */}
      <Modal
        visible={habitsModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setHabitsModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <View style={{ width: 34 }} />
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Habits</Text>
            <TouchableOpacity
              onPress={() => setHabitsModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Ionicons name="close" size={18} color={colors.black} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            <Text style={styles.modalEmoji}>🏆</Text>
            <Text style={[styles.modalTitle, { color: colors.black }]}>Habits bijhouden</Text>
            <Text style={[styles.modalBody, { color: colors.gray600 ?? '#666' }]}>
              Log dagelijkse gewoontes op 3 niveaus: Brons, Zilver en Goud.
            </Text>

            <View style={[styles.examplesCard, { backgroundColor: colors.offWhite, borderColor: colors.gray100 }]}>
              <Text style={[styles.examplesLabel, { color: colors.gray400 }]}>Voorbeelden</Text>
              {HABITS_EXAMPLES.map((ex, i) => (
                <View key={i} style={styles.exampleRow}>
                  <Ionicons name="chatbubble-outline" size={13} color={colors.gray400} />
                  <Text style={[styles.exampleText, { color: colors.gray600 ?? '#666' }]}>{ex}</Text>
                </View>
              ))}
            </View>

            <View style={[styles.noteCard, { backgroundColor: colors.yellowLight ?? '#FFF9CC', borderColor: colors.yellow }]}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.yellow} />
              <Text style={[styles.noteText, { color: colors.black }]}>
                Maak habits aan via WhatsApp. Ze verschijnen dan hier in de app.
              </Text>
            </View>

            <TouchableOpacity onPress={confirmHabitsOnboarding} activeOpacity={0.85} style={styles.modalPrimaryBtn}>
              <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.modalPrimaryBtnGrad}>
                <Text style={styles.modalPrimaryBtnText}>Begrepen!</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setHabitsModalVisible(false)} style={styles.cancelBtn}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Annuleer</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.offWhite },
  content: { paddingBottom: 120 },
  banner: { alignItems: 'center', paddingTop: 24, paddingBottom: 36, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  avatarBox: { marginBottom: 14 },
  avatar: { width: 72, height: 72, borderRadius: 22 },
  bannerName: { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.white, letterSpacing: -0.3, marginBottom: 4 },
  bannerNumber: { fontFamily: 'Inter_300Light', fontSize: 14, color: '#666' },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    color: Colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 24,
    marginBottom: 8,
    marginLeft: 20,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    marginHorizontal: 24,
    overflow: 'hidden',
    ...Shadow.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.gray100,
    justifyContent: 'center', alignItems: 'center',
  },
  rowIconDanger: { backgroundColor: '#FEE2E2' },
  rowLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.black },
  rowLabelDanger: { color: '#EF4444' },
  rowValue: { fontFamily: 'Inter_300Light', fontSize: 15, color: Colors.gray400 },
  divider: { height: 1, backgroundColor: Colors.gray100, marginHorizontal: 16 },
  timeInput: {
    borderWidth: 1, borderColor: Colors.gray200, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.black,
    width: 60, textAlign: 'center', backgroundColor: Colors.offWhite,
  },
  saveBtn: { borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: Colors.black },
  modeToggle: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modeBtnActive: { backgroundColor: Colors.yellow },
  modeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  modeBtnTextActive: { color: Colors.black },
  themeToggle: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  themeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 10,
    backgroundColor: Colors.gray100,
  },
  themeBtnActive: { backgroundColor: Colors.yellow },
  themeBtnLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.gray400 },
  themeBtnLabelActive: { color: Colors.black },

  // Modal styles
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  modalHeaderTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  closeBtn: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  modalContent: { padding: 28, paddingBottom: 60, alignItems: 'center', gap: 16 },
  modalEmoji: { fontSize: 48 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'center', letterSpacing: -0.5 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  examplesCard: {
    width: '100%',
    borderRadius: Radius.md,
    padding: 16,
    borderWidth: 1,
    gap: 10,
  },
  examplesLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  exampleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  exampleText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1, lineHeight: 19 },
  noteCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    width: '100%',
    borderRadius: Radius.md,
    padding: 14,
    borderWidth: 1,
  },
  noteText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1, lineHeight: 19 },
  modalPrimaryBtn: { width: '100%' },
  modalPrimaryBtnGrad: {
    borderRadius: Radius.pill,
    paddingVertical: 17,
    alignItems: 'center',
  },
  modalPrimaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },
  cancelBtn: { paddingVertical: 10 },
  cancelText: { fontFamily: 'Inter_400Regular', fontSize: 15 },
});
