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

export default function InstellingenTab() {
  const { user, prefs, logout, refreshPrefs } = useUser();
  const { themeMode, setThemeMode, isDark, colors } = useTheme();
  const { settings, updateSetting } = useModuleSettings();
  const insets = useSafeAreaInsets();
  const [saving, setSaving] = useState(false);
  const [reminderTime, setReminderTime] = useState(prefs?.habits_reminder_time?.slice(0, 5) ?? '20:00');

  async function toggleHabits(value: boolean) {
    if (!user || user.id === 'dev') return;
    setSaving(true);
    await supabase.from('user_prefs').upsert({ user_id: user.id, habits_enabled: value }, { onConflict: 'user_id' });
    await refreshPrefs();
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

  function confirmLogout() {
    Alert.alert('Koppeling verwijderen?', 'Je kunt opnieuw koppelen met hetzelfde nummer.', [
      { text: 'Annuleer', style: 'cancel' },
      { text: 'Verwijder', style: 'destructive', onPress: logout },
    ]);
  }

  return (
    <ScrollView style={[styles.container, { backgroundColor: colors.offWhite }]} contentContainerStyle={styles.content}>
      {/* Profile banner */}
      <View style={[styles.banner, { paddingTop: insets.top + 48 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
        <View style={styles.avatarBox}>
          <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.avatar}>
            <Text style={styles.avatarEmoji}>🍳</Text>
          </LinearGradient>
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
                  {m === 'lite' ? 'Lite' : 'Uitgebreid'}
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
                  {m === 'lite' ? 'Lite' : 'Uitgebreid'}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.offWhite },
  content: { paddingBottom: 120 },
  banner: { alignItems: 'center', paddingTop: 24, paddingBottom: 36, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  avatarBox: { marginBottom: 14 },
  avatar: { width: 72, height: 72, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  avatarEmoji: { fontSize: 36 },
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
});
