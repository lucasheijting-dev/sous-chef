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
  Pressable,
  Easing,
  KeyboardAvoidingView,
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
    const local = digits.slice(2);
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
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}>
        {inner}
      </Pressable>
    );
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

function SpringModal({ visible, children, ...rest }: React.ComponentProps<typeof Modal> & { children: React.ReactNode }) {
  const translateY = useRef(new Animated.Value(30)).current;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (visible) {
      translateY.setValue(30);
      setReady(false);
      const t = setTimeout(() => {
        setReady(true);
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
          damping: 18,
          stiffness: 200,
          mass: 0.8,
        }).start();
      }, 50);
      return () => clearTimeout(t);
    }
  }, [visible]);

  return (
    <Modal visible={visible} {...rest}>
      <Animated.View style={[{ flex: 1 }, ready ? { transform: [{ translateY }] } : undefined]}>
        {children}
      </Animated.View>
    </Modal>
  );
}

function AnimatedStatChip({ emoji, value, label }: { emoji: string; value: number; label: string }) {
  const [displayed, setDisplayed] = useState(0);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const duration = 600;
    const steps = 30;
    const interval = duration / steps;
    let step = 0;

    const id = setInterval(() => {
      step++;
      const progress = step / steps;
      const eased = 1 - Math.pow(1 - progress, 2);
      setDisplayed(Math.round(eased * value));
      if (step >= steps) {
        clearInterval(id);
        setDisplayed(value);
      }
    }, interval);

    return () => clearInterval(id);
  }, [value]);

  return (
    <View style={styles.statChip}>
      <Text style={styles.statChipText}>{emoji} {displayed} {label}</Text>
    </View>
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

  const scrollViewRef = useRef<ScrollView>(null);
  const [scrollY, setScrollY] = useState(0);

  const [saving, setSaving] = useState(false);
  const [reminderTime, setReminderTime] = useState(prefs?.habits_reminder_time?.slice(0, 5) ?? '20:00');

  // Modals
  const [habitsModalVisible, setHabitsModalVisible] = useState(false);
  const [nameModalVisible, setNameModalVisible] = useState(false);
  const [nameInputValue, setNameInputValue] = useState(settings.user_name ?? '');
  const [modulesModalVisible, setModulesModalVisible] = useState(false);
  const [meldingModalVisible, setMeldingModalVisible] = useState(false);
  const [suggestiesModalVisible, setSuggestiesModalVisible] = useState(false);
  const [themeModalVisible, setThemeModalVisible] = useState(false);
  const [profielModalVisible, setProfielModalVisible] = useState(false);
  const [agendaModalVisible, setAgendaModalVisible] = useState(false);
  const [accountModalVisible, setAccountModalVisible] = useState(false);
  const [infoModalVisible, setInfoModalVisible] = useState(false);
  const [cheatSheetVisible, setCheatSheetVisible] = useState(false);
  const [feedbackModalVisible, setFeedbackModalVisible] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);

  // Profiel context
  const [profileBirthYear, setProfileBirthYear] = useState('');
  const [profileEmployer, setProfileEmployer] = useState('');
  const [profileFriends, setProfileFriends] = useState('');
  const [profileExtra, setProfileExtra] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileWoonsituatie, setProfileWoonsituatie] = useState('');
  const [profileKinderen, setProfileKinderen] = useState('');
  const [profileLeefomgeving, setProfileLeefomgeving] = useState('');
  const [profileInteresses, setProfileInteresses] = useState<string[]>([]);

  // Inline name edit in banner
  const [editingName, setEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(settings.user_name ?? '');

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

  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [caldavConnected, setCaldavConnected] = useState(false);
  const [caldavCreds, setCaldavCreds] = useState<{ username: string; password: string } | null>(null);
  const [showCaldavCreds, setShowCaldavCreds] = useState(false);
  const [messageCount, setMessageCount] = useState<number | null>(null);
  const [listsCount, setListsCount] = useState<number | null>(null);
  const [eventsCount, setEventsCount] = useState<number | null>(null);

  const [suggestionsFreq, setSuggestionsFreq] = useState<'daily' | 'weekly' | 'never'>(
    (prefs as any)?.suggestions_frequency ?? 'weekly',
  );

  // ── Mount fetches ────────────────────────────────────────────────────────────

  const fetchUserData = useCallback(async () => {
    if (!user || user.id === 'dev') return;

    isGeoAlertEnabled().then(setGeoAlertEnabled);

    const [userRow, listsResult, eventsResult, prefsRow] = await Promise.all([
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
      supabase
        .from('user_prefs')
        .select('profile_birth_year, profile_employer, profile_friends, profile_extra')
        .eq('user_id', user.id)
        .single(),
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
    if (prefsRow.data) {
      setProfileBirthYear(String(prefsRow.data.profile_birth_year ?? ''));
      setProfileEmployer(prefsRow.data.profile_employer ?? '');
      setProfileFriends(prefsRow.data.profile_friends ?? '');
      try {
        const parsed = JSON.parse(prefsRow.data.profile_extra ?? '{}');
        setProfileWoonsituatie(parsed.woonsituatie ?? '');
        setProfileKinderen(parsed.kinderen ?? '');
        setProfileLeefomgeving(parsed.leefomgeving ?? '');
        setProfileInteresses(Array.isArray(parsed.interesses) ? parsed.interesses : []);
        setProfileExtra(parsed.vrij ?? '');
      } catch {
        setProfileExtra(prefsRow.data.profile_extra ?? '');
      }
    }
  }, [user?.id]);

  useEffect(() => { fetchUserData(); }, [fetchUserData]);

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

  useEffect(() => {
    setNameInputValue(settings.user_name ?? '');
    setNameValue(settings.user_name ?? '');
  }, [settings.user_name]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  async function copyToClipboard(value: string) {
    await Clipboard.setStringAsync(value);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    showToast('Gekopieerd');
  }

  async function saveProfile() {
    if (!user || user.id === 'dev') return;
    setProfileSaving(true);
    const birthYearNum = parseInt(profileBirthYear, 10);
    const extraJson = JSON.stringify({
      woonsituatie: profileWoonsituatie || undefined,
      kinderen: profileKinderen || undefined,
      leefomgeving: profileLeefomgeving || undefined,
      interesses: profileInteresses.length > 0 ? profileInteresses : undefined,
      vrij: profileExtra.trim() || undefined,
    });
    await Promise.all([
      supabase.from('user_prefs').upsert({
        user_id: user.id,
        profile_birth_year: isNaN(birthYearNum) ? null : birthYearNum,
        profile_employer: profileEmployer.trim() || null,
        profile_friends: profileFriends.trim() || null,
        profile_extra: extraJson,
      }, { onConflict: 'user_id' }),
      updateSetting('user_name', nameValue.trim()),
    ]);
    setProfileSaving(false);
    setProfielModalVisible(false);
    showToast('Profiel opgeslagen');
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
        setGeoAlertEnabled(true);
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

  async function saveBannerName() {
    const trimmed = nameValue.trim();
    await updateSetting('user_name', trimmed);
    setEditingName(false);
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

  async function handleExportData() {
    if (!user || user.id === 'dev') {
      Alert.alert('Komt binnenkort!', 'Data exporteren wordt binnenkort beschikbaar.');
      return;
    }
    try {
      const res = await fetch(`${API_BASE}/export/${user.id}`);
      if (!res.ok) throw new Error('not_found');
      showToast('Export gestart — je ontvangt een bestand', 'success');
    } catch {
      Alert.alert('Komt binnenkort!', 'Data exporteren wordt binnenkort beschikbaar.');
    }
  }

  async function sendFeedback() {
    if (!feedbackText.trim()) return;
    setFeedbackSaving(true);
    await supabase.from('feedback').insert({
      user_id: user?.id ?? null,
      message: feedbackText.trim(),
    });
    setFeedbackSaving(false);
    setFeedbackModalVisible(false);
    setFeedbackText('');
    showToast('Feedback verstuurd, dankjewel! 🙏', 'success');
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Account verwijderen?',
      'Weet je zeker dat je je account wilt verwijderen? Dit kan niet ongedaan worden gemaakt.',
      [
        { text: 'Annuleer', style: 'cancel' },
        {
          text: 'Ja, verwijder',
          style: 'destructive',
          onPress: () => {
            Alert.alert(
              'Neem contact op',
              'Stuur een WhatsApp-bericht naar +31 6 84 96 53 18 om je account te laten verwijderen.',
              [
                {
                  text: 'WhatsApp openen',
                  onPress: () =>
                    Linking.openURL('whatsapp://send?phone=31684965318&text=Ik%20wil%20mijn%20account%20verwijderen'),
                },
                { text: 'Sluiten', style: 'cancel' },
              ],
            );
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

          {/* Inline name edit */}
          {editingName ? (
            <View style={{ alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <TextInput
                value={nameValue}
                onChangeText={setNameValue}
                style={styles.bannerNameInput}
                autoFocus
                selectionColor={Colors.yellow}
                returnKeyType="done"
                onSubmitEditing={saveBannerName}
                onBlur={saveBannerName}
                placeholderTextColor="rgba(255,255,255,0.4)"
                placeholder="Jouw naam"
              />
              <TouchableOpacity onPress={saveBannerName} style={styles.bannerSaveBtn}>
                <Text style={styles.bannerSaveBtnText}>Opslaan</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              onPress={() => {
                setNameValue(displayName ?? '');
                setEditingName(true);
              }}
              activeOpacity={0.75}
              style={styles.nameTouchable}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.bannerName}>{displayName || 'Sous-Chef'}</Text>
                <Ionicons name="pencil-outline" size={13} color="rgba(255,255,255,0.4)" />
              </View>
              {displayName ? <Text style={styles.bannerSubtitle}>Sous-Chef</Text> : null}
            </TouchableOpacity>
          )}

          {/* Phone + copy button */}
          <TouchableOpacity
            style={{ alignItems: 'center' }}
            onPress={() => copyToClipboard('+31684965318')}
            activeOpacity={0.7}
          >
            <Text style={styles.bannerNumber}>
              {user?.whatsapp_number ? formatPhone(user.whatsapp_number) : '—'}
            </Text>
            <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
              Tik om te kopiëren
            </Text>
          </TouchableOpacity>

          {/* Lid sinds */}
          {lidSinds ? (
            <Text style={styles.bannerMeta}>Lid sinds {lidSinds}</Text>
          ) : null}

          {/* Stats chips with count-up animation */}
          {(messageCount !== null || listsCount !== null || eventsCount !== null) ? (
            <View style={styles.statsRow}>
              {messageCount !== null ? (
                <AnimatedStatChip emoji="💬" value={messageCount} label="berichten" />
              ) : null}
              {eventsCount !== null ? (
                <AnimatedStatChip emoji="📅" value={eventsCount} label="afspraken" />
              ) : null}
              {listsCount !== null ? (
                <AnimatedStatChip emoji="📋" value={listsCount} label="lijsten" />
              ) : null}
            </View>
          ) : null}
        </View>

        {/* ── Profiel ────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Profiel</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="person-outline"
            label="Mijn profiel"
            subtitle="Naam, leeftijd, werkgever, vrienden"
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setProfielModalVisible(true)}
          />
        </View>

        {/* ── Voorkeuren ─────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Voorkeuren</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="grid-outline"
            label="Modules"
            subtitle="Agenda, habits, notities en bonnetjes"
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setModulesModalVisible(true)}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="notifications-outline"
            label="Meldingen"
            value={prefs?.habits_enabled ? reminderTime : geoAlertEnabled ? 'Aan' : 'Uit'}
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setMeldingModalVisible(true)}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="bulb-outline"
            label="Suggesties"
            value={SUGGESTIONS_FREQ_OPTIONS.find(o => o.value === suggestionsFreq)?.label}
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setSuggestiesModalVisible(true)}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="contrast-outline"
            label="Thema"
            value={THEME_OPTIONS.find(o => o.mode === themeMode)?.label}
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setThemeModalVisible(true)}
          />
        </View>

        {/* ── Agenda ─────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Agenda</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="calendar-outline"
            label="Agenda & categorieën"
            subtitle={caldavConnected ? 'iPhone Agenda: Verbonden' : 'Koppelen + categorie-instellingen'}
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setAgendaModalVisible(true)}
          />
        </View>

        {/* ── Account ────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Account</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="settings-outline"
            label="Account beheren"
            subtitle="Onboarding, data export, verwijderen"
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setAccountModalVisible(true)}
          />
        </View>

        {/* ── Info ───────────────────────────────────────────────────── */}
        <Text style={[styles.sectionLabel, { color: colors.gray400 }]}>Info</Text>
        <View style={[styles.card, { backgroundColor: colors.white }]}>
          <SettingsRow
            icon="chatbubble-ellipses-outline"
            label="Feedback geven"
            subtitle="Stuur een suggestie of melding"
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => { setFeedbackText(''); setFeedbackModalVisible(true); }}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="help-circle-outline"
            label="Wat kan ik vragen?"
            subtitle="Overzicht van alle WhatsApp-commando's"
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setCheatSheetVisible(true)}
          />
          <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
          <SettingsRow
            icon="information-circle-outline"
            label="Over Sous-Chef"
            subtitle="Hulp, privacy, gebruiksvoorwaarden"
            right={<Ionicons name="chevron-forward" size={16} color={colors.gray400} />}
            onPress={() => setInfoModalVisible(true)}
          />
        </View>

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

      {/* Bottom fade */}
      <LinearGradient
        colors={[`${colors.offWhite}00`, colors.offWhite]}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 100, pointerEvents: 'none' }}
      />

      <Toast {...toastProps} />

      {/* ── Habits onboarding modal ──────────────────────────────────── */}
      <SpringModal
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
      </SpringModal>

      {/* ── Stream edit modal ───────────────────────────────────────── */}
      <SpringModal
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
      </SpringModal>

      {/* ── Modules modal ───────────────────────────────────────────── */}
      <SpringModal
        visible={modulesModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setModulesModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setModulesModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Modules</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={[styles.card, { backgroundColor: colors.white, marginTop: 20 }]}>
              <View style={styles.moduleRow}>
                <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="calendar-outline" size={18} color={colors.black} />
                </View>
                <View style={styles.moduleRowInner}>
                  <Text style={[styles.rowLabel, { color: colors.black }]}>Agenda</Text>
                  <Text style={[styles.modeDesc, { color: colors.gray400 }]}>Afspraken met kalender- en lijstweergave</Text>
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
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
                        {settings.habits_mode === 'lite' ? 'Snel afvinken' : 'Streaks, statistieken, week-strip'}
                      </Text>
                    </View>
                  </View>
                </>
              )}
              <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
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
          </ScrollView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Meldingen modal ─────────────────────────────────────────── */}
      <SpringModal
        visible={meldingModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setMeldingModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setMeldingModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Meldingen</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={[styles.card, { backgroundColor: colors.white, marginTop: 20 }]}>
              {prefs?.habits_enabled ? (
                <>
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
                  <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
                </>
              ) : null}
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
          </ScrollView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Suggesties modal ────────────────────────────────────────── */}
      <SpringModal
        visible={suggestiesModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setSuggestiesModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setSuggestiesModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Suggesties</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={[styles.card, { backgroundColor: colors.white, marginTop: 20 }]}>
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
                          style={[styles.modeBtn, { backgroundColor: colors.gray100 }, suggestionsFreq === opt.value && styles.modeBtnActive]}
                          onPress={() => saveSuggestionsFreq(opt.value)}
                        >
                          <Text style={[styles.modeBtnText, { color: colors.gray400 }, suggestionsFreq === opt.value && styles.modeBtnTextActive]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                </>
              ) : null}
            </View>
          </ScrollView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Thema modal ─────────────────────────────────────────────── */}
      <SpringModal
        visible={themeModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setThemeModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setThemeModalVisible(false)}
              style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
            >
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Thema</Text>
            <View style={{ width: 72 }} />
          </View>
          <View style={{ padding: 20 }}>
            <View style={[styles.card, { backgroundColor: colors.white, marginHorizontal: 0 }]}>
              {THEME_OPTIONS.map((opt, idx) => (
                <View key={opt.mode}>
                  {idx > 0 && <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />}
                  <TouchableOpacity
                    style={styles.row}
                    onPress={() => { handleThemeChange(opt.mode); setThemeModalVisible(false); }}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.rowIcon, { backgroundColor: colors.gray100 }]}>
                      <Ionicons name={opt.icon} size={18} color={colors.black} />
                    </View>
                    <Text style={[styles.rowLabel, { color: colors.black, flex: 1 }]}>{opt.label}</Text>
                    {themeMode === opt.mode && (
                      <Ionicons name="checkmark" size={20} color={Colors.yellow} />
                    )}
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          </View>
        </SafeAreaView>
      </SpringModal>

      {/* ── Name edit modal (kept for direct access if needed) ───────── */}
      <SpringModal
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
      </SpringModal>

      {/* ── Profiel modal ────────────────────────────────────────────── */}
      <SpringModal
        visible={profielModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setProfielModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setProfielModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Mijn profiel</Text>
            <TouchableOpacity onPress={saveProfile} disabled={profileSaving} style={[styles.closeBtn, { backgroundColor: Colors.yellow, opacity: profileSaving ? 0.6 : 1 }]}>
              <Text style={[styles.saveBtnText, { color: Colors.black }]}>{profileSaving ? '...' : 'Opslaan'}</Text>
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <ScrollView contentContainerStyle={{ padding: 20, gap: 24, paddingBottom: 60 }}>
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400, lineHeight: 18 }}>
                Claude gebruikt dit als context bij elke conversatie, zodat hij jou beter leert kennen.
              </Text>

              {/* Naam */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Naam</Text>
                <TextInput
                  style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
                  value={nameValue}
                  onChangeText={setNameValue}
                  placeholder="Jouw naam"
                  placeholderTextColor={colors.gray400}
                  selectionColor={Colors.yellow}
                  returnKeyType="done"
                />
                <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: colors.gray400 }}>Wordt ook in de banner getoond</Text>
              </View>

              {/* Geboortejaar – chips per decennium */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Geboortejaar</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['1960–1969','1970–1979','1980–1989','1985–1989','1990–1994','1995–1999','2000–2004','2005–2009'].map(decade => {
                    const yr = decade.split('–')[0];
                    const selected = profileBirthYear === yr;
                    return (
                      <TouchableOpacity
                        key={decade}
                        onPress={() => setProfileBirthYear(selected ? '' : yr)}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: selected ? Colors.yellow : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: selected ? Colors.black : colors.gray400 }}>{decade}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: colors.gray400 }}>Claude berekent je leeftijd hieruit</Text>
              </View>

              {/* Werkgever – type chips */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Situatie</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['Student','Werknemer','ZZP\'er','Manager','Ondernemer','Gepensioneerd','Anders'].map(opt => {
                    const selected = profileEmployer === opt;
                    return (
                      <TouchableOpacity
                        key={opt}
                        onPress={() => setProfileEmployer(selected ? '' : opt)}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: selected ? Colors.yellow : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: selected ? Colors.black : colors.gray400 }}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Woonsituatie */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Woonsituatie</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['Alleenstaand', 'Met partner', 'Getrouwd', 'Gescheiden', 'Weduwe/Weduwnaar'].map(opt => {
                    const selected = profileWoonsituatie === opt;
                    return (
                      <TouchableOpacity key={opt} onPress={() => setProfileWoonsituatie(selected ? '' : opt)}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: selected ? Colors.yellow : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: selected ? Colors.black : colors.gray400 }}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Kinderen */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Kinderen</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['Geen kinderen', 'Baby/peuter', 'Basisschool', 'Middelbare school', 'Volwassen kinderen'].map(opt => {
                    const selected = profileKinderen === opt;
                    return (
                      <TouchableOpacity key={opt} onPress={() => setProfileKinderen(selected ? '' : opt)}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: selected ? Colors.yellow : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: selected ? Colors.black : colors.gray400 }}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Leefomgeving */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Leefomgeving</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['Grote stad', 'Middelgrote stad', 'Dorp', 'Platteland'].map(opt => {
                    const selected = profileLeefomgeving === opt;
                    return (
                      <TouchableOpacity key={opt} onPress={() => setProfileLeefomgeving(selected ? '' : opt)}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: selected ? Colors.yellow : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: selected ? Colors.black : colors.gray400 }}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Interesses */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Interesses (meerdere mogelijk)</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {['Sport', 'Koken', 'Reizen', 'Muziek', 'Film & TV', 'Lezen', 'Natuur', 'Technologie', 'Gezondheid', 'Kunst', 'Gaming'].map(opt => {
                    const selected = profileInteresses.includes(opt);
                    return (
                      <TouchableOpacity key={opt}
                        onPress={() => setProfileInteresses(prev => selected ? prev.filter(i => i !== opt) : [...prev, opt])}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: selected ? Colors.yellow : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: selected ? Colors.black : colors.gray400 }}>{opt}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {/* Vrienden */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Vrienden & mensen</Text>
                <TextInput
                  style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
                  value={profileFriends}
                  onChangeText={setProfileFriends}
                  placeholder="Bijv. Jan, Emma, Thomas..."
                  placeholderTextColor={colors.gray400}
                  selectionColor={Colors.yellow}
                  returnKeyType="done"
                />
                <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: colors.gray400 }}>Komma-gescheiden — Claude herkent deze namen</Text>
              </View>

              {/* Extra */}
              <View style={{ gap: 8 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Extra context</Text>
                <TextInput
                  style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black, minHeight: 80, textAlignVertical: 'top' }]}
                  value={profileExtra}
                  onChangeText={setProfileExtra}
                  placeholder="Bijv. hobby's, dieetwensen, andere context..."
                  placeholderTextColor={colors.gray400}
                  selectionColor={Colors.yellow}
                  multiline
                />
                <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: colors.gray400 }}>Vrij tekstveld voor Claude</Text>
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Agenda modal ─────────────────────────────────────────────── */}
      <SpringModal
        visible={agendaModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAgendaModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setAgendaModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Agenda</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={[styles.card, { backgroundColor: colors.white, marginTop: 20 }]}>
              <SettingsRow
                icon="calendar-outline"
                label="iPhone Agenda koppelen"
                subtitle="Na installatie: Instellingen → Algemeen → VPN en apparaatbeheer"
                right={
                  caldavConnected ? (
                    <View style={styles.connectedBadge}><Text style={styles.connectedBadgeText}>✓ Verbonden</Text></View>
                  ) : (
                    <View style={styles.disconnectedBadge}><Text style={styles.disconnectedBadgeText}>Niet gekoppeld</Text></View>
                  )
                }
                onPress={openCalendarProfile}
              />
              {caldavCreds && (
                <>
                  <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
                  <TouchableOpacity
                    style={styles.credRow}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowCaldavCreds(v => !v); }}
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
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 20, marginTop: 28, marginBottom: 8 }}>
              <Text style={[styles.sectionLabel, { color: colors.gray400, marginTop: 0, marginBottom: 0, marginLeft: 0 }]}>Categorieën</Text>
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
                    <TouchableOpacity style={styles.row} onPress={() => openStreamModal(stream)} activeOpacity={0.7}>
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
          </ScrollView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Account modal ────────────────────────────────────────────── */}
      <SpringModal
        visible={accountModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setAccountModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setAccountModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Account</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }}>
            <View style={[styles.card, { backgroundColor: colors.white }]}>
              <SettingsRow icon="refresh-outline" label="Bekijk onboarding opnieuw" onPress={confirmResetOnboarding} />
              <View style={[styles.divider, { backgroundColor: colors.gray100 }]} />
              <SettingsRow icon="download-outline" label="Exporteer mijn data" onPress={handleExportData} />
            </View>
            <View style={[styles.card, styles.dangerCard, { backgroundColor: colors.white }]}>
              <SettingsRow icon="log-out-outline" label="Koppeling verwijderen" danger onPress={confirmLogout} />
              <View style={styles.dangerCardSubtitleWrap}>
                <Text style={styles.dangerCardSubtitle}>Je WhatsApp-koppeling wordt verwijderd. Data blijft bewaard.</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: '#FEE2E2' }]} />
              <SettingsRow icon="trash-outline" label="Account verwijderen" danger onPress={confirmDeleteAccount} />
              <View style={styles.dangerCardSubtitleWrap}>
                <Text style={styles.dangerCardSubtitle}>Al je data wordt permanent verwijderd.</Text>
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Cheat Sheet modal ───────────────────────────────────────── */}
      <SpringModal
        visible={cheatSheetVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCheatSheetVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setCheatSheetVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Wat kan ik vragen?</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 20 }}>
            {[
              { emoji: '📋', title: 'Lijsten', items: [
                '"maak een boodschappenlijst"',
                '"voeg melk, brood en kaas toe"',
                '"verwijder alles wat afgevinkt is"',
                '"maak een links-lijst met favoriete websites"',
              ]},
              { emoji: '📅', title: 'Agenda', items: [
                '"tandarts vrijdag 10 uur"',
                '"verjaardag mama 15 maart"',
                '"verwijder de tandarts afspraak"',
                '"wat staat er morgen op de planning?"',
              ]},
              { emoji: '🏋️', title: 'Habits', items: [
                '"voeg habit toe: mediteren"',
                '"mini=5min, goed=15min, elite=30min"',
                '"mijn mediteren streak?"',
              ]},
              { emoji: '📝', title: 'Notities', items: [
                '"onthoud: altijd bellen voor bezoek aan Jan"',
                '"noteer: wifi wachtwoord is Appel123"',
                '"wat heb ik over Jan opgeslagen?"',
              ]},
              { emoji: '🧾', title: 'Bonnetjes', items: [
                'Stuur een foto van een kassabon',
                '"hoeveel heb ik deze maand uitgegeven?"',
              ]},
              { emoji: '💬', title: 'Algemeen', items: [
                '"wat kun je allemaal?"',
                '"toon mijn agenda van deze week"',
                '"toon alle openstaande lijsten"',
              ]},
            ].map(section => (
              <View key={section.title} style={[styles.card, { backgroundColor: colors.white, padding: 16 }]}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.black, marginBottom: 12 }}>
                  {section.emoji} {section.title}
                </Text>
                {section.items.map((item, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <Text style={{ color: Colors.yellow, fontSize: 14, lineHeight: 20 }}>›</Text>
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray600 ?? '#555', flex: 1, lineHeight: 20, fontStyle: 'italic' }}>{item}</Text>
                  </View>
                ))}
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Feedback modal ──────────────────────────────────────────── */}
      <SpringModal
        visible={feedbackModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setFeedbackModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setFeedbackModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Annuleer</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Feedback</Text>
            <TouchableOpacity
              onPress={sendFeedback}
              disabled={!feedbackText.trim() || feedbackSaving}
              style={[styles.closeBtn, { backgroundColor: feedbackText.trim() ? Colors.yellow : colors.gray200 }]}
            >
              {feedbackSaving
                ? <ActivityIndicator size="small" color={Colors.black} />
                : <Text style={[styles.saveBtnText, { color: Colors.black }]}>Stuur</Text>}
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={{ padding: 20, gap: 12, flex: 1 }}>
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400, lineHeight: 18 }}>
                Wat kun je verbeteren? Wat mist er? Elk bericht helpt.
              </Text>
              <TextInput
                style={[styles.nameInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black, minHeight: 140, textAlignVertical: 'top', padding: 14 }]}
                value={feedbackText}
                onChangeText={setFeedbackText}
                placeholder="Schrijf hier je feedback..."
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
                multiline
                autoFocus
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </SpringModal>

      {/* ── Info modal ───────────────────────────────────────────────── */}
      <SpringModal
        visible={infoModalVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setInfoModalVisible(false)}
      >
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setInfoModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.cancelText, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[styles.modalHeaderTitle, { color: colors.black }]}>Over Sous-Chef</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 12 }}>
            <View style={[styles.card, { backgroundColor: colors.white }]}>
              <SettingsRow
                icon="chatbubble-outline"
                label="Hulp of feedback"
                onPress={() => Linking.openURL('whatsapp://send?phone=31684965318&text=Hoi%2C%20ik%20heb%20een%20vraag%20over%20Sous-Chef')}
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
            <Text style={[styles.versionText, { color: colors.gray400, marginTop: 8 }]}>Sous-Chef v{appVersion}</Text>
          </ScrollView>
        </SafeAreaView>
      </SpringModal>
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
    paddingTop: 28,
    paddingBottom: 40,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    overflow: 'hidden',
  },
  avatarBox: { marginBottom: 14 },
  avatar: { width: 72, height: 72, borderRadius: 22 },
  nameTouchable: { alignItems: 'center', gap: 4 },
  bannerName: { fontFamily: 'TitanOne_400Regular', fontSize: 22, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 2 },
  bannerNameInput: {
    fontFamily: 'TitanOne_400Regular',
    fontSize: 22,
    color: Colors.white,
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    borderBottomWidth: 1.5,
    borderBottomColor: 'rgba(255,255,255,0.5)',
    paddingHorizontal: 16,
    paddingVertical: 4,
    minWidth: 160,
  },
  bannerSaveBtn: {
    backgroundColor: Colors.yellow,
    borderRadius: Radius.pill,
    paddingHorizontal: 20,
    paddingVertical: 8,
  },
  bannerSaveBtnText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: Colors.black,
  },
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
    marginTop: 36,
    marginBottom: 10,
    marginLeft: 20,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    marginHorizontal: 20,
    overflow: 'hidden',
    ...Shadow.card,
  },
  dangerCard: {
    borderColor: '#FEE2E2',
    borderWidth: 1,
    marginTop: 12,
  },
  dangerCardSubtitleWrap: { paddingHorizontal: 18, paddingBottom: 14 },
  dangerCardSubtitle: {
    fontFamily: 'Inter_300Light',
    fontSize: 12,
    color: '#EF4444',
    marginLeft: 48,
  },

  // Row
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 16, gap: 14 },
  rowTall: { paddingVertical: 14 },
  rowIcon: {
    width: 36, height: 36, borderRadius: 11,
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

  divider: { height: 1, backgroundColor: Colors.gray100, marginHorizontal: 18 },

  // Module rows
  moduleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, gap: 12 },
  moduleRowInner: { flex: 1, gap: 4 },
  moduleRowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeDesc: { fontFamily: 'Inter_300Light', fontSize: 12, color: Colors.gray400, lineHeight: 16 },

  // Mode toggle
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

  // Calendar connection badges
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
  credRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, gap: 12 },
  credToggleText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  credBox: { borderRadius: Radius.md, padding: 12, marginTop: 4, gap: 2 },
});
