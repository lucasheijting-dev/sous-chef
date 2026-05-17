import { useState, useEffect, useRef, useCallback } from 'react';
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
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { useTheme, ThemeMode } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { Colors, Radius, Shadow } from '@/constants/Design';
import { Toast, useToast } from '@/components/Toast';
import { startGeoAlertTask, stopGeoAlertTask, isGeoAlertEnabled } from '@/lib/geoAlert';

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('31') && digits.length === 11) {
    // +31 X XX XX XX XX
    const local = digits.slice(2); // 9 digits
    return `+31 ${local[0]} ${local.slice(1, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7, 9)}`;
  }
  return `+${digits}`;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SettingsRow({
  icon,
  label,
  subtitle,
  value,
  right,
  danger,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  subtitle?: string;
  value?: string;
  right?: React.ReactNode;
  danger?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const inner = (
    <View style={[styles.row, subtitle ? styles.rowTall : undefined]}>
      <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }, danger && styles.rowIconDanger]}>
        <Ionicons name={icon} size={18} color={danger ? '#EF4444' : colors.black} />
      </View>
      <View style={styles.rowLabelWrap}>
        <Text style={[styles.rowLabel, { color: colors.black }, danger && styles.rowLabelDanger]}>{label}</Text>
        {subtitle ? (
          <Text style={[styles.rowSubtitle, { color: colors.gray400 }]}>{subtitle}</Text>
        ) : null}
      </View>
      {value !== undefined && <Text style={[styles.rowValue, { color: colors.gray400 }]}>{value}</Text>}
      {right}
    </View>
  );

  if (onPress) {
    return <TouchableOpacity onPress={onPress} activeOpacity={0.7}>{inner}</TouchableOpacity>;
  }
  return inner;
}

function CredRow({ label, value, colors, onCopy }: { label: string; value: string; colors: any; onCopy: (v: string) => void }) {
  return (
    <TouchableOpacity
      style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 }}
      onPress={() => onCopy(value)}
      activeOpacity={0.6}
    >
      <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.gray400, flex: 1 }}>{label}</Text>
      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.black, flex: 2, textAlign: 'right' }} numberOfLines={1}>{value}</Text>
      <Ionicons name="copy-outline" size={13} color={colors.gray400} style={{ marginLeft: 6 }} />
    </TouchableOpacity>
  );
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

const SUGGESTIONS_FREQ_OPTIONS: { value: 'daily' | 'weekly' | 'never'; label: string }[] = [
  { value: 'daily',  label: 'Dagelijks' },
  { value: 'weekly', label: 'Wekelijks' },
  { value: 'never',  label: 'Nooit' },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function InstellingenTab() {
  const { user, prefs, logout, refreshPrefs } = useUser();
  const { themeMode, setThemeMode, colors } = useTheme();
  const { settings, updateSetting, updateSettings } = useModuleSettings();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { toastProps, show: showToast } = useToast();

  // Scroll-to-top
  const scrollViewRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);

  // Reminder state
  const [saving, setSaving] = useState(false);
  const [reminderTime, setReminderTime] = useState(prefs?.habits_reminder_time?.slice(0, 5) ?? '20:00');

  // Modals
  const [habitsModalVisible, setHabitsModalVisible] = useState(false);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInputValue, setNameInputValue] = useState(settings.user_name ?? '');

  // Geo-alert
  const [geoAlertEnabled, setGeoAlertEnabled] = useState(false);
  const [geoAlertLoading, setGeoAlertLoading] = useState(false);

  // Calendar streams
  const [streams, setStreams] = useState<any[]>([]);
  const [streamModalVisible, setStreamModalVisible] = useState(false);
  const [editingStream, setEditingStream] = useState<any | null>(null);
  const [streamName, setStreamName] = useState('');
  const [streamEmoji, setStreamEmoji] = useState('');
  const [streamColor, setStreamColor] = useState('#4A90D8');
  const [streamSaving, setStreamSaving] = useState(false);

  const STREAM_COLORS = [
    '#4A90D8', '#FF6B6B', '#4ECDC4', '#6B8CFF', '#FCC10C', '#FF9F43',
    '#2ECC71', '#E84393', '#95A5A6', '#1ABC9C', '#E67E22', '#8E44AD',
  ];

  // User data fetched from Supabase
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [caldavConnected, setCaldavConnected] = useState(false);
  const [caldavCreds, setCaldavCreds] = useState<{ username: string; password: string } | null>(null);
  const [showCaldavCreds, setShowCaldavCreds] = useState(false);
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [listsCount, setListsCount] = useState<number | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);

  // Suggestions frequency
  const [suggestionsFreq, setSuggestionsFreq] = useState<'daily' | 'weekly' | 'never'>(
    (prefs as any)?.suggestions_frequency ?? 'weekly',
  );

  // ── Mount fetches ────────────────────────────────────────────────────────────

  const fetchUserData = useCallback(async () => {
    if (!user || user.id === 'dev') return;

    isGeoAlertEnabled().then(setGeoAlertEnabled);

    const [userRow, listsResult, eventsResult] = await Promise.all([
      supabase
        .from('users')
        .select('caldav_username, caldav_password, created_at, message_count')
        .eq('id', user.id)
        .single(),
      supabase
        .from('lists')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase
        .from('events')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id),
    ]);

    if (userRow.data) {
      setCaldavConnected(!!userRow.data.caldav_username);
        if (userRow.data.caldav_username && userRow.data.caldav_password) {
          setCaldavCreds({ username: userRow.data.caldav_username, password: userRow.data.caldav_password });
        }
      setCreatedAt(userRow.data.created_at ?? null);
      setMessageCount(userRow.data.message_count ?? null);
    }
    if (listsResult.count !== null) setListsCount(listsResult.count);
    if (eventsResult.count !== null) setEventsCount(eventsResult.count);
  }, [user?.id]);

  // Fetch on mount
  useEffect(() => { fetchUserData(); }, [fetchUserData]);

  // Re-fetch CalDAV status + streams every time this tab gets focus
  useFocusEffect(useCallback(() => {
    if (!user || user.id === 'dev') return;
    supabase
      .from('users')
      .select('caldav_username')
      .eq('id', user.id)
      .single()
      .then(({ data }) => { if (data) setCaldavConnected(!!data.caldav_username); });
    supabase
      .from('calendar_streams')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order', { ascending: true })
      .then(({ data }) => { if (data) setStreams(data); });
  }, [user?.id]));

  // Keep name input in sync with settings
  useEffect(() => {
    setNameInputValue(settings.user_name ?? '');
  }, [settings.user_name]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function copyToClipboard(value: string) {
    await Clipboard.setStringAsync(value);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('Gekopieerd');
  }

  async function toggleHabits(value: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!user || user.id === 'dev') return;
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
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!user || user.id === 'dev') return;
    await supabase.from('user_prefs').upsert({ user_id: user.id, suggestions_enabled: value }, { onConflict: 'user_id' });
    await refreshPrefs();
  }

  async function toggleNotes(v: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateSetting('notes_enabled', v);
  }

  async function handleCalendarMode(m: 'lite' | 'full') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateSetting('calendar_mode', m);
  }

  async function handleHabitsMode(m: 'lite' | 'full') {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    updateSetting('habits_mode', m);
  }

  async function handleThemeChange(mode: ThemeMode) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setThemeMode(mode);
  }

  async function toggleGeoAlert(value: boolean) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (!user || user.id === 'dev') return;
    setGeoAlertLoading(true);
    if (value) {
      const result = await startGeoAlertTask(user.id);
      if (result === 'ok') {
        setGeoAlertEnabled(true);
      } else if (result === 'denied') {
        Alert.alert('Locatietoestemming vereist', 'Geef locatietoegang in Instellingen om deze functie te gebruiken.');
      } else {
        setGeoAlertEnabled(true); // expo-go degraded mode
      }
    } else {
      await stopGeoAlertTask();
      setGeoAlertEnabled(false);
    }
    setGeoAlertLoading(false);
  }

  async function saveReminderTime() {
    if (!user || user.id === 'dev') return;
    if (!reminderTime.match(/^\d{2}:\d{2}$/)) {
      Alert.alert('Ongeldig formaat', 'Gebruik HH:MM, bijv. 20:00');
      return;
    }
    await supabase.from('user_prefs').upsert(
      { user_id: user.id, habits_reminder_time: `${reminderTime}:00` },
      { onConflict: 'user_id' },
    );
    await refreshPrefs();
    showToast(`Reminder ingesteld op ${reminderTime}`, 'success');
  }

  async function saveSuggestionsFreq(freq: 'daily' | 'weekly' | 'never') {
    setSuggestionsFreq(freq);
    if (!user || user.id === 'dev') return;
    await supabase.from('user_prefs').upsert(
      { user_id: user.id, suggestions_frequency: freq },
      { onConflict: 'user_id' },
    );
  }

  async function saveName() {
    await updateSetting('user_name', nameInputValue.trim());
    setNameModalVisible(false);
  }

  function openStreamModal(stream: any | null) {
    setEditingStream(stream);
    setStreamName(stream?.name ?? '');
    setStreamEmoji(stream?.emoji ?? '📅');
    setStreamColor(stream?.color ?? '#4A90D8');
    setStreamModalVisible(true);
  }

  async function saveStream() {
    if (!user || user.id === 'dev' || !streamName.trim()) return;
    setStreamSaving(true);
    const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';
    try {
      if (editingStream) {
        const res = await fetch(`${API_BASE_URL}/calendar-streams/${user.id}/${editingStream.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: streamName.trim(), emoji: streamEmoji, color: streamColor }),
        });
        const updated = await res.json();
        setStreams(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        const caldav_id = `stream-${Date.now()}`;
        const res = await fetch(`${API_BASE_URL}/calendar-streams/${user.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: streamName.trim(), emoji: streamEmoji, color: streamColor, caldav_id, claude_key: caldav_id }),
        });
        const created = await res.json();
        setStreams(prev => [...prev, created]);
      }
      setStreamModalVisible(false);
      showToast(editingStream ? 'Categorie bijgewerkt' : 'Categorie toegevoegd', 'success');
    } catch {
      showToast('Opslaan mislukt', 'error');
    } finally {
      setStreamSaving(false);
    }
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

  function confirmResetOnboarding() {
    Alert.alert(
      'Rondleiding opnieuw?',
      'Je wordt naar het beginscherm geleid.',
      [
        { text: 'Annuleer', style: 'cancel' },
        {
          text: 'Opnieuw starten',
          onPress: async () => {
            await updateSettings({ onboarding_done: false });
            router.replace('/onboarding' as any);
          },
        },
      ],
    );
  }

  // ── Derived display values ───────────────────────────────────────────────────

  const displayName = settings.user_name?.trim() || null;
  const appVersion = Constants.expoConfig?.version ?? '1.0.0';

  const lidSinds = createdAt
    ? new Date(createdAt).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        ref={scrollViewRef}
        style={[styles.container, { backgroundColor: colors.offWhite }]}
        contentContainerStyle={[styles.content, { paddingBottom: 120 + insets.bottom }]}
        onScroll={e => setScrollY(e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
      >
        {/* ── Profile banner ─────────────────────────────────────────── */}
        <View style={[styles.banner, { paddingTop: insets.top + 48 }]}>
          <BlurView
            intensity={Platform.OS === 'web' ? 60 : 80}
            tint="dark"
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]}
            pointerEvents="none"
          />
          <View style={styles.avatarBox}>
            <Image source={require('@/assets/images/logo.jpg')} style={styles.avatar} />
          </View>

          {/* Name / title */}
          <TouchableOpacity
            onPress={() => setNameModalVisible(true)}
            activeOpacity={0.75}
            style={styles.nameTouchable}
          >
            {displayName ? (
              <>
                <Text style={styles.bannerName}>{displayName}</Text>
                <Text style={styles.bannerSubtitle}>Sous-Chef</Text>
              </>
            ) : (
              <Text style={styles.bannerName}>Sous-Chef</Text>
            )}
            <Ionicons name="pencil-outline" size={14} color="rgba(255,255,255,0.45)" style={styles.pencilIcon} />
          </TouchableOpacity>

          {/* Phone */}
          <Text style={styles.bannerNumber}>
            {user?.whatsapp_number ? formatPhone(user.whatsapp_number) : '—'}
          </Text>

          {/* Lid sinds */}
          {lidSinds ? (
            <Text style={styles.bannerMeta}>Lid sinds {lidSinds}</Text>
          ) : null}

          {/* Stats chips */}
          {(messageCount !== null || listsCount !== null || eventsCount !== null) ? (
            <View style={styles.statsRow}>
              {messageCount !== null ? (
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>💬 {messageCount} berichten</Text>
                </View>
              ) : null}
              {eventsCount !== null ? (
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>📅 {eventsCount} afspraken</Text>
                </View>
              ) : null}
              {listsCount !== null ? (
                <View style={styles.statChip}>
                  <Text style={styles.statChipText}>📋 {listsCount} lijsten</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ── Modules ────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Modules</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          {/* Calendar mode */}
          <View style={styles.moduleRow}>
            <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="calendar-outline" size={18} color={colors.black} />
            </View>
            <View style={styles.moduleRowInner}>
              <View style={styles.moduleRowTop}>
                <Text style={[styles.rowLabel, { color: colors.black }]}>Agenda</Text>
                <View style={styles.modeToggle}>
                  {(['lite', 'full'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      style={[styles.modeBtn, { backgroundColor: colors.gray100 }, settings.calendar_mode === m && styles.modeBtnActive]}
                      onPress={() => handleCalendarMode(m)}
                    >
                      <Text style={[styles.modeBtnText, { color: colors.gray400 }, settings.calendar_mode === m && styles.modeBtnTextActive]}>
                        {m === 'lite' ? 'Simpel' : 'Uitgebreid'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <Text style={[styles.modeDesc, { color: colors.gray400 }]}>
                {settings.calendar_mode === 'lite'
                  ? 'Alleen vandaag\'s afspraken'
                  : 'Volledige planning + kalenderweergave'}
              </Text>
            </View>
          </View>

          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />

          {/* Habits tab toggle */}
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
              <View style={styles.moduleRow}>
                <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="trophy-outline" size={18} color={colors.black} />
                </View>
                <View style={styles.moduleRowInner}>
                  <View style={styles.moduleRowTop}>
                    <Text style={[styles.rowLabel, { color: colors.black }]}>Habits stijl</Text>
                    <View style={styles.modeToggle}>
                      {(['lite', 'full'] as const).map(m => (
                        <TouchableOpacity
                          key={m}
                          style={[styles.modeBtn, { backgroundColor: colors.gray100 }, settings.habits_mode === m && styles.modeBtnActive]}
                          onPress={() => handleHabitsMode(m)}
                        >
                          <Text style={[styles.modeBtnText, { color: colors.gray400 }, settings.habits_mode === m && styles.modeBtnTextActive]}>
                            {m === 'lite' ? 'Simpel' : 'Uitgebreid'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <Text style={[styles.modeDesc, { color: colors.gray400 }]}>
                    {settings.habits_mode === 'lite'
                      ? 'Snel afvinken'
                      : 'Streaks, statistieken, week-strip'}
                  </Text>
                </View>
              </View>
            </>
          )}

          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />

          {/* Notes toggle */}
          <SettingsRow
            icon="document-text-outline"
            label="Notities tab"
            subtitle="WhatsApp-notities worden altijd opgeslagen."
            right={
              <Switch
                value={settings.notes_enabled}
                onValueChange={toggleNotes}
                trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                thumbColor={Colors.white}
              />
            }
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          {/* Receipts toggle */}
          <SettingsRow
            icon="receipt-outline"
            label="Bonnetjes tab"
            subtitle="Scan kassabonnen via WhatsApp. Claude leest ze automatisch."
            right={
              <Switch
                value={settings.receipts_enabled}
                onValueChange={v => updateSetting('receipts_enabled', v)}
                trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                thumbColor={Colors.white}
              />
            }
          />
        </View>

        {/* ── Meldingen ──────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Meldingen</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          {/* Habits reminder */}
          {prefs?.habits_enabled ? (
            <View style={styles.row}>
              <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                <Ionicons name="notifications-outline" size={18} color={colors.black} />
              </View>
              <Text style={[styles.rowLabel, { color: colors.black }]}>Habits reminder</Text>
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
          ) : null}

          {prefs?.habits_enabled && <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />}

          {/* Geo-alert toggle */}
          <SettingsRow
            icon="location-outline"
            label="Supermarktherinnering"
            subtitle="Herinnert je aan je boodschappenlijst bij een supermarkt."
            right={
              geoAlertLoading ? (
                <ActivityIndicator size="small" color={Colors.yellow} />
              ) : (
                <Switch
                  value={geoAlertEnabled}
                  onValueChange={toggleGeoAlert}
                  trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                  thumbColor={Colors.white}
                />
              )
            }
          />
        </View>

        {/* ── Suggesties ─────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Suggesties</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="bulb-outline"
            label="Suggesties"
            subtitle="Wekelijkse tips op basis van je gebruik."
            right={
              <Switch
                value={prefs?.suggestions_enabled ?? true}
                onValueChange={toggleSuggestions}
                trackColor={{ false: Colors.gray200, true: Colors.yellow }}
                thumbColor={Colors.white}
              />
            }
          />

          {(prefs?.suggestions_enabled ?? true) ? (
            <>
              <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
              <View style={styles.freqRow}>
                <Text style={[styles.freqLabel, { color: colors.gray400 }]}>Frequentie</Text>
                <View style={styles.modeToggle}>
                  {SUGGESTIONS_FREQ_OPTIONS.map(opt => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[
                        styles.modeBtn,
                        { backgroundColor: colors.gray100 },
                        suggestionsFreq === opt.value && styles.modeBtnActive,
                      ]}
                      onPress={() => saveSuggestionsFreq(opt.value)}
                    >
                      <Text
                        style={[
                          styles.modeBtnText,
                          { color: colors.gray400 },
                          suggestionsFreq === opt.value && styles.modeBtnTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* ── Weergave ───────────────────────────────────────────────── */}
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
                onPress={() => handleThemeChange(opt.mode)}
                activeOpacity={0.7}
              >
                <Ionicons name={opt.icon} size={15} color={themeMode === opt.mode ? Colors.black : colors.gray400} />
                <Text style={[styles.themeBtnLabel, { color: colors.gray400 }, themeMode === opt.mode && styles.themeBtnLabelActive]}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── iPhone Agenda ──────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>iPhone Agenda</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="calendar-outline"
            label="iPhone Agenda koppelen"
            right={
              caldavConnected ? (
                <View style={styles.connectedBadge}>
                  <Text style={styles.connectedBadgeText}>✓ Verbonden</Text>
                </View>
              ) : (
                <View style={styles.disconnectedBadge}>
                  <Text style={styles.disconnectedBadgeText}>Niet gekoppeld</Text>
                </View>
              )
            }
            onPress={openCalendarProfile}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <View style={styles.calInstructions}>
            <Text style={[styles.calInstructionsText, { color: colors.gray400 }]}>
              Na installatie: Instellingen → Algemeen → VPN en apparaatbeheer
            </Text>
          </View>
          {caldavCreds && (
            <>
              <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
              <TouchableOpacity
                style={styles.credRow}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowCaldavCreds(v => !v);
                }}
                activeOpacity={0.7}
              >
                <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="key-outline" size={18} color={colors.black} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowLabel, { color: colors.black }]}>iPhone vraagt om een wachtwoord?</Text>
                  <Text style={[styles.rowSubtitle, { color: colors.gray400 }]}>Tik om inloggegevens te bekijken en kopiëren</Text>
                </View>
                <Ionicons name={showCaldavCreds ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
              </TouchableOpacity>
              {showCaldavCreds && (
                <View style={[styles.credBox, { backgroundColor: colors.offWhite }]}>
                  <Text style={{ fontFamily: 'Inter_300Light', fontSize: 12, color: colors.gray400, marginBottom: 8 }}>
                    Tik op een veld om het te kopiëren, plak het in het wachtwoordscherm van iOS.
                  </Text>
                  <CredRow label="Server" value="caldav.sous-chef.nl" colors={colors} onCopy={copyToClipboard} />
                  <CredRow label="Gebruikersnaam" value={caldavCreds.username} colors={colors} onCopy={copyToClipboard} />
                  <CredRow label="Wachtwoord" value={caldavCreds.password} colors={colors} onCopy={copyToClipboard} />
                </View>
              )}
            </>
          )}
        </View>

        {/* ── Agenda categorieën ─────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginTop: 32, marginBottom: 8 }}>
          <Text style={[styles.sectionLabel, { color: colors.gray400, marginTop: 0, marginBottom: 0, marginLeft: 0 }]}>Agenda categorieën</Text>
          <TouchableOpacity onPress={() => openStreamModal(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="add-circle-outline" size={22} color={Colors.yellow} />
          </TouchableOpacity>
        </View>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          {streams.length === 0 ? (
            <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400 }}>Nog geen categorieën</Text>
            </View>
          ) : (
            streams.map((stream, idx) => (
              <View key={stream.id}>
                {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />}
                <TouchableOpacity
                  style={styles.row}
                  onPress={() => openStreamModal(stream)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: stream.color ?? '#4A90D8' }} />
                  </View>
                  <View style={styles.rowLabelWrap}>
                    <Text style={[styles.rowLabel, { color: colors.black }]}>{stream.emoji} {stream.name}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>

        {/* ── Account ────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="refresh-outline"
            label="Rondleiding opnieuw"
            onPress={confirmResetOnboarding}
          />
        </View>

        {/* Danger card: koppeling verwijderen */}
        <View style={[styles.card, styles.dangerCard, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="log-out-outline"
            label="Koppeling verwijderen"
            danger
            onPress={confirmLogout}
          />
          <View style={styles.dangerCardSubtitleWrap}>
            <Text style={styles.dangerCardSubtitle}>
              Je WhatsApp-koppeling wordt verwijderd. Data blijft bewaard.
            </Text>
          </View>
        </View>

        {/* ── Info ───────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Info</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="chatbubble-outline"
            label="Hulp of feedback"
            onPress={() =>
              Linking.openURL('whatsapp://send?phone=31684965318&text=Hoi%2C%20ik%20heb%20een%20vraag%20over%20Sous-Chef')
            }
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="shield-outline"
            label="Privacybeleid"
            onPress={() => Linking.openURL('https://sous-chef.nl/privacy')}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="document-outline"
            label="Gebruiksvoorwaarden"
            onPress={() => Linking.openURL('https://sous-chef.nl/terms')}
          />
        </View>

        {/* App version */}
        <Text style={[styles.versionText, { color: colors.gray400 }]}>Sous-Chef v{appVersion}</Text>
      </ScrollView>

      {/* Scroll to top button */}
      {scrollY > 300 ? (
        <TouchableOpacity
          style={[styles.scrollTopBtn, { bottom: 100 + insets.bottom }]}
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            scrollViewRef.current?.scrollTo({ y: 0, animated: true });
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="chevron-up" size={22} color={Colors.black} />
        </TouchableOpacity>
      ) : null}

      {/* Toast */}
      <Toast {...toastProps} />

      {/* ── Habits onboarding modal ──────────────────────────────────── */}
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

      {/* ── Stream edit modal ───────────────────────────────────────── */}
      <Modal
        visible={streamModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setStreamModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setStreamModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Annuleer</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>
              {editingStream ? 'Bewerk categorie' : 'Nieuwe categorie'}
            </Text>
            <TouchableOpacity
              onPress={saveStream}
              disabled={streamSaving || !streamName.trim()}
              style={[styles.closeBtn, { backgroundColor: Colors.yellow, opacity: streamName.trim() ? 1 : 0.4 }]}
            >
              {streamSaving
                ? <ActivityIndicator size="small" color={Colors.black} />
                : <Text style={[styles.saveBtnText, { color: Colors.black }]}>Opslaan</Text>
              }
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionLabel, { marginLeft: 0, marginTop: 0, color: colors.gray400 }]}>Naam</Text>
              <TextInput
                style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
                value={streamName}
                onChangeText={setStreamName}
                placeholder="Bijv. Familie"
                placeholderTextColor={colors.gray400}
                autoFocus={!editingStream}
                selectionColor={Colors.yellow}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionLabel, { marginLeft: 0, marginTop: 0, color: colors.gray400 }]}>Emoji</Text>
              <TextInput
                style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
                value={streamEmoji}
                onChangeText={t => {
                  const chars = [...t];
                  setStreamEmoji(chars[chars.length - 1] ?? '');
                }}
                placeholder="📅"
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={[styles.sectionLabel, { marginLeft: 0, marginTop: 0, color: colors.gray400 }]}>Kleur</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {STREAM_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    onPress={() => setStreamColor(c)}
                    style={[
                      { width: 40, height: 40, borderRadius: 20, backgroundColor: c },
                      streamColor === c && { borderWidth: 3, borderColor: colors.black },
                    ]}
                    activeOpacity={0.8}
                  />
                ))}
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Name edit modal ──────────────────────────────────────────── */}
      <Modal
        visible={nameModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setNameModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setNameModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Annuleer</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Naam</Text>
            <TouchableOpacity
              onPress={saveName}
              style={[styles.closeBtn, { backgroundColor: Colors.yellow }]}
            >
              <Text style={[styles.saveBtnText, { color: Colors.black }]}>Opslaan</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.nameModalContent}>
            <TextInput
              style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
              value={nameInputValue}
              onChangeText={setNameInputValue}
              placeholder="Jouw naam"
              placeholderTextColor={colors.gray400}
              autoFocus
              selectionColor={Colors.yellow}
              returnKeyType="done"
              onSubmitEditing={saveName}
            />
            <Text style={[styles.nameInputHint, { color: colors.gray400 }]}>
              Wordt getoond in de profielbanner.
            </Text>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.offWhite },
  content: { paddingBottom: 120 },

  // Banner
  banner: {
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 36,
    borderBottomLeftRadius: 28,
    borderBottomRightRadius: 28,
    overflow: 'hidden',
  },
  avatarBox: { marginBottom: 14 },
  avatar: { width: 72, height: 72, borderRadius: 22 },
  nameTouchable: { alignItems: 'center', flexDirection: 'column', gap: 2 },
  bannerName: { fontFamily: 'TitanOne_400Regular', fontSize: 22, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  bannerSubtitle: { fontFamily: 'Inter_300Light', fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 2 },
  pencilIcon: { marginTop: 4 },
  bannerNumber: { fontFamily: 'Inter_300Light', fontSize: 14, color: '#888', marginTop: 6 },
  bannerMeta: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 4 },
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14, justifyContent: 'center' },
  statChip: {
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderRadius: Radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  statChipText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: 'rgba(255,255,255,0.65)' },

  // Section labels
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: Colors.gray400,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 32,
    marginBottom: 8,
    marginLeft: 20,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: Radius.lg,
    marginHorizontal: 24,
    overflow: 'hidden',
    ...Shadow.card,
  },
  dangerCard: {
    borderColor: '#FEE2E2',
    borderWidth: 1,
    marginTop: 12,
  },
  dangerCardSubtitleWrap: { paddingHorizontal: 16, paddingBottom: 12 },
  dangerCardSubtitle: {
    fontFamily: 'Inter_300Light',
    fontSize: 12,
    color: '#EF4444',
    marginLeft: 46,
  },

  // Row
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  rowTall: { paddingVertical: 12 },
  rowIcon: {
    width: 34, height: 34, borderRadius: 10,
    backgroundColor: Colors.gray100,
    justifyContent: 'center', alignItems: 'center',
    flexShrink: 0,
  },
  rowIconDanger: { backgroundColor: '#FEE2E2' },
  rowLabelWrap: { flex: 1, gap: 2 },
  rowLabel: { fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.black },
  rowLabelDanger: { color: '#EF4444' },
  rowSubtitle: { fontFamily: 'Inter_300Light', fontSize: 12, color: Colors.gray400, lineHeight: 16 },
  rowValue: { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400 },

  divider: { height: 1, backgroundColor: Colors.gray100, marginHorizontal: 16 },

  // Module rows with description
  moduleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  moduleRowInner: { flex: 1, gap: 4 },
  moduleRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeDesc: { fontFamily: 'Inter_300Light', fontSize: 12, color: Colors.gray400, lineHeight: 16 },

  // Mode toggle (segmented)
  modeToggle: { flexDirection: 'row', gap: 6 },
  modeBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  modeBtnActive: { backgroundColor: Colors.yellow },
  modeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  modeBtnTextActive: { color: Colors.black },

  // Disabled hint
  disabledHintRow: { paddingHorizontal: 16, paddingVertical: 12, paddingLeft: 62 },
  disabledHint: { fontFamily: 'Inter_300Light', fontSize: 13, color: Colors.gray400, lineHeight: 18 },

  // Frequency row
  freqRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  freqLabel: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.gray400, flex: 1 },

  // Reminder time
  timeInput: {
    borderWidth: 1, borderColor: Colors.gray200, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.black,
    width: 60, textAlign: 'center', backgroundColor: Colors.offWhite,
  },
  saveBtn: { borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8 },
  saveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: Colors.black },

  // Theme
  themeToggle: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  themeBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 10,
    backgroundColor: Colors.gray100,
  },
  themeBtnActive: { backgroundColor: Colors.yellow },
  themeBtnLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.gray400 },
  themeBtnLabelActive: { color: Colors.black },

  // Calendar connection status badges
  connectedBadge: {
    backgroundColor: '#DCFCE7',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  connectedBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#16A34A',
  },
  disconnectedBadge: {
    backgroundColor: '#FEF3C7',
    borderRadius: Radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  disconnectedBadgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 12,
    color: '#D97706',
  },
  calInstructions: { paddingHorizontal: 16, paddingBottom: 12, paddingLeft: 62 },
  calInstructionsText: { fontFamily: 'Inter_300Light', fontSize: 12, color: Colors.gray400, lineHeight: 17 },

  // App version
  versionText: {
    fontFamily: 'Inter_300Light',
    fontSize: 12,
    color: Colors.gray400,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 8,
  },

  // Scroll to top
  scrollTopBtn: {
    position: 'absolute',
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.yellow,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  },

  // Modal (shared)
  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  modalHeaderTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  closeBtn: { minWidth: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  modalContent: { padding: 28, paddingBottom: 60, alignItems: 'center', gap: 16 },
  modalEmoji: { fontSize: 48 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 26, textAlign: 'center', letterSpacing: -0.5 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  examplesCard: { width: '100%', borderRadius: Radius.md, padding: 16, borderWidth: 1, gap: 10 },
  examplesLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
  exampleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  exampleText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1, lineHeight: 19 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, width: '100%', borderRadius: Radius.md, padding: 14, borderWidth: 1 },
  noteText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1, lineHeight: 19 },
  modalPrimaryBtn: { width: '100%' },
  modalPrimaryBtnGrad: { borderRadius: Radius.pill, paddingVertical: 17, alignItems: 'center' },
  modalPrimaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },
  cancelBtn: { paddingVertical: 10 },
  cancelText: { fontFamily: 'Inter_400Regular', fontSize: 15 },

  // Name modal
  nameModalContent: { padding: 24, gap: 10 },
  nameInput: {
    borderWidth: 1,
    borderRadius: Radius.md,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontFamily: 'Inter_400Regular',
    fontSize: 17,
  },
  nameInputHint: { fontFamily: 'Inter_300Light', fontSize: 13, color: Colors.gray400 },
  credRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  credToggleText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  credBox: { borderRadius: Radius.md, padding: 12, marginTop: 4, gap: 2 },
});
