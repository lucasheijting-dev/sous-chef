import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Modal,
  Pressable,
  Platform,
  AppState,
  KeyboardAvoidingView,
  ActivityIndicator,
  Animated,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { Colors, Radius, Shadow, TAB_BAR_CLEARANCE } from '@/constants/Design';
import { Toast, useToast } from '@/components/Toast';
import { TimerCategory, TimerSession } from '@/lib/types';

// ── Types ──────────────────────────────────────────────────────────────────────

type TimerPhase = 'setup' | 'running' | 'paused' | 'reflecting' | 'abandoning';
type ActiveView = 'timer' | 'overzicht';
type MoodScore = 1 | 2 | 3;
type PeriodType = 'week';

// ── Constants ─────────────────────────────────────────────────────────────────

const TIMER_SIZE = 260;
const TC = TIMER_SIZE / 2;
const PIE_R = 112;
const INNER_R = 70;

const CATEGORY_COLORS = [
  '#F3B500', '#E85D4A', '#4A90D8', '#4ECDC4',
  '#6B8CFF', '#2ECC71', '#E84393', '#FF9F43',
  '#8E44AD', '#1ABC9C', '#E67E22', '#95A5A6',
];

const MOOD_OPTIONS: { score: MoodScore; emoji: string; label: string }[] = [
  { score: 1, emoji: '😔', label: 'Afgeleid ↓' },
  { score: 2, emoji: '🙂', label: 'Neutraal →' },
  { score: 3, emoji: '🤩', label: 'Gefocust ↑' },
];

const ABANDON_REASONS: { key: string; label: string }[] = [
  { key: 'distraction', label: 'Afleiding' },
  { key: 'too_long',    label: 'Te lang' },
  { key: 'done',        label: 'Klaar' },
  { key: 'other',       label: 'Anders' },
];

const WEEK_DAY_LABELS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function piePath(cx: number, cy: number, r: number, fraction: number): string {
  if (fraction <= 0) return '';
  if (fraction >= 1) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }
  const deg = fraction * 360;
  const end = polarToCartesian(cx, cy, r, deg);
  const largeArc = deg > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function formatTime(secs: number): string {
  const s = Math.max(0, Math.ceil(secs));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
}

function formatMins(secs: number): string {
  const m = Math.round(secs / 60);
  return `${m} min`;
}

function formatHourRange(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00–${String(hour + 1).padStart(2, '0')}:00`;
}

function getWeekRange(offset: number): { start: Date; end: Date; label: string } {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now);
  monday.setDate(now.getDate() - dow + offset * 7);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  const fmt = (d: Date) => d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  return { start: monday, end: sunday, label: `${fmt(monday)} – ${fmt(sunday)}` };
}

function computeTimerStreak(sessions: TimerSession[]): number {
  const completedDays = new Set(
    sessions.filter(s => s.status === 'completed').map(s => s.started_at.slice(0, 10))
  );
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 90; i++) {
    const ds = d.toISOString().split('T')[0];
    if (!completedDays.has(ds)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function haptic(style: 'light' | 'medium' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

// ── CircularTimer ─────────────────────────────────────────────────────────────

function CircularTimer({
  fraction,
  displaySecs,
  color,
  trackColor,
  centerColor,
}: {
  fraction: number;
  displaySecs: number;
  color: string;
  trackColor: string;
  centerColor: string;
}) {
  const path = piePath(TC, TC, PIE_R, fraction);
  const tipPos = fraction > 0 && fraction < 1 ? polarToCartesian(TC, TC, PIE_R, fraction * 360) : null;

  return (
    <View style={{ width: TIMER_SIZE, height: TIMER_SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={TIMER_SIZE} height={TIMER_SIZE}>
        {/* Track background circle */}
        <Circle cx={TC} cy={TC} r={PIE_R} fill={trackColor} />
        {/* Progress pie */}
        {path ? <Path d={path} fill={color} /> : null}
        {/* Center white circle */}
        <Circle cx={TC} cy={TC} r={INNER_R} fill={centerColor} />
        {/* Tip dot on arc edge */}
        {tipPos && (
          <Circle cx={tipPos.x} cy={tipPos.y} r={6} fill={centerColor} />
        )}
      </Svg>
      {/* Time text overlay */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={[s.timerDisplay, { color: Colors.black }]}>{formatTime(displaySecs)}</Text>
        </View>
      </View>
    </View>
  );
}

// ── CategoryPill ──────────────────────────────────────────────────────────────

function CategoryPill({
  category,
  onPress,
  small = false,
}: {
  category: TimerCategory | null;
  onPress?: () => void;
  small?: boolean;
}) {
  const { colors } = useTheme();
  const color = category?.color ?? colors.gray200;
  const label = category?.name ?? 'Geen categorie';
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.75 : 1}
      style={[
        s.catPill,
        small && s.catPillSmall,
        { backgroundColor: `${color}22`, borderColor: `${color}55` },
      ]}
    >
      <View style={[s.catDot, { backgroundColor: color }, small && s.catDotSmall]} />
      <Text style={[
        s.catPillText,
        small && s.catPillTextSmall,
        { color: category ? color : colors.gray400 },
      ]}>{label}</Text>
      {onPress && <Ionicons name="chevron-down" size={small ? 12 : 14} color={category ? color : colors.gray400} />}
    </TouchableOpacity>
  );
}

// ── ActionButton ──────────────────────────────────────────────────────────────

function ActionButton({
  icon,
  label,
  onPress,
  accent = false,
  danger = false,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  accent?: boolean;
  danger?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={s.actionBtn}>
      <View style={[
        s.actionBtnInner,
        { backgroundColor: accent ? Colors.yellow : danger ? '#FEE2E2' : colors.gray100 },
      ]}>
        <Ionicons
          name={icon}
          size={22}
          color={accent ? Colors.black : danger ? '#EF4444' : colors.gray400}
        />
      </View>
      <Text style={[s.actionBtnLabel, { color: colors.gray400 }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ── StatsCard ─────────────────────────────────────────────────────────────────

function StatsCard({
  label,
  value,
  change,
  sub,
}: {
  label: string;
  value: string;
  change?: number | null;
  sub?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[s.statsCard, { backgroundColor: colors.white }]}>
      <Text style={[s.statsCardLabel, { color: colors.gray400 }]}>{label}</Text>
      <Text style={[s.statsCardValue, { color: colors.black }]}>{value}</Text>
      {sub ? <Text style={[s.statsCardSub, { color: colors.gray400 }]}>{sub}</Text> : null}
      {change !== null && change !== undefined ? (
        <Text style={[s.statsCardChange, { color: change >= 0 ? '#22C55E' : '#EF4444' }]}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(Math.round(change))}%
        </Text>
      ) : null}
    </View>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TimerTab() {
  const { user } = useUser();
  const { colors } = useTheme();
  const { settings, updateSetting } = useModuleSettings();
  const insets = useSafeAreaInsets();
  const { toastProps, show: showToast } = useToast();

  // ── Sub-tab ─────────────────────────────────────────────────────────────────
  const [activeView, setActiveView] = useState<ActiveView>('timer');

  // ── Timer phase ─────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<TimerPhase>('setup');

  // ── Setup state ─────────────────────────────────────────────────────────────
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [intent, setIntent] = useState('');
  const [plannedMins, setPlannedMins] = useState(settings.timer_default_minutes);

  // ── Running state (refs for interval accuracy) ───────────────────────────────
  const startedAtMsRef = useRef<number>(0);
  const totalPausedMsRef = useRef<number>(0);
  const pausedAtMsRef = useRef<number>(0);
  const plannedSecsRef = useRef<number>(plannedMins * 60);
  const sessionIdRef = useRef<string | null>(null);
  const breakIdRef = useRef<string | null>(null);

  // ── Display state (re-renders) ───────────────────────────────────────────────
  const [displaySecs, setDisplaySecs] = useState(plannedMins * 60);
  const [progressFraction, setProgressFraction] = useState(0);
  const [muted, setMuted] = useState(false);

  // ── Break countdown ─────────────────────────────────────────────────────────
  const [breakDisplaySecs, setBreakDisplaySecs] = useState(settings.timer_break_minutes * 60);
  const [pauseMoodScore, setPauseMoodScore] = useState<MoodScore | null>(null);
  const breakStartedAtRef = useRef<number>(0);
  const breakPlannedSecsRef = useRef<number>(settings.timer_break_minutes * 60);

  // ── Overtime ─────────────────────────────────────────────────────────────────
  const [isOvertime, setIsOvertime] = useState(false);
  const isOvertimeRef = useRef(false);

  // ── Notification ─────────────────────────────────────────────────────────────
  const scheduledNotifIdRef = useRef<string | null>(null);

  // ── Reflection state ─────────────────────────────────────────────────────────
  const [moodScore, setMoodScore] = useState<MoodScore | null>(null);
  const [reflectionNote, setReflectionNote] = useState('');
  const [reflectCountdown, setReflectCountdown] = useState(60);
  const [actualDurationSecs, setActualDurationSecs] = useState(0);

  // ── Abandon state ────────────────────────────────────────────────────────────
  const [abandonReason, setAbandonReason] = useState<string | null>(null);
  const [abandonNote, setAbandonNote] = useState('');

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [categories, setCategories] = useState<TimerCategory[]>([]);
  const [recentSessions, setRecentSessions] = useState<TimerSession[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  // ── Modals ──────────────────────────────────────────────────────────────────
  const [catPickerVisible, setCatPickerVisible] = useState(false);
  const [sessionOptionsVisible, setSessionOptionsVisible] = useState(false);
  const [catManagerVisible, setCatManagerVisible] = useState(false);
  const [sessionPrefsVisible, setSessionPrefsVisible] = useState(false);

  // ── Overview state ──────────────────────────────────────────────────────────
  const [weekOffset, setWeekOffset] = useState(0);
  const [overzichtSessions, setOverzichtSessions] = useState<TimerSession[]>([]);
  const [prevSessions, setPrevSessions] = useState<TimerSession[]>([]);
  const [loadingOverview, setLoadingOverview] = useState(false);

  // ── Category manager ─────────────────────────────────────────────────────────
  const [editingCategory, setEditingCategory] = useState<TimerCategory | null>(null);
  const [catFormVisible, setCatFormVisible] = useState(false);
  const [catName, setCatName] = useState('');
  const [catColor, setCatColor] = useState(CATEGORY_COLORS[0]);
  const [catSaving, setCatSaving] = useState(false);

  // ── Deep work pre-fill from notification tap ──────────────────────────────────
  useFocusEffect(useCallback(() => {
    if (phase !== 'setup') return;
    AsyncStorage.getItem('deep_work_prefill_minutes').then(val => {
      if (!val) return;
      const mins = parseInt(val, 10);
      if (!isNaN(mins) && mins > 0) {
        setPlannedMins(Math.min(120, Math.max(5, mins)));
        AsyncStorage.removeItem('deep_work_prefill_minutes').catch(() => {});
      }
    }).catch(() => {});
  }, [phase]));

  // ── Fetch data ────────────────────────────────────────────────────────────────

  const fetchCategories = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoadingData(false); return; }
    const { data } = await supabase
      .from('timer_categories')
      .select('*')
      .eq('user_id', user.id)
      .order('sort_order');
    if (data) {
      setCategories(data);
      setSelectedCategoryId(prev => {
        if (prev) return prev;
        const werk = data.find((c: any) => c.name.toLowerCase() === 'werk');
        return werk ? werk.id : (data[0]?.id ?? null);
      });
    }
    setLoadingData(false);
  }, [user]);

  const fetchRecentSessions = useCallback(async () => {
    if (!user || user.id === 'dev') return;
    const since = new Date();
    since.setDate(since.getDate() - 90);
    const { data } = await supabase
      .from('timer_sessions')
      .select('*')
      .eq('user_id', user.id)
      .gte('started_at', since.toISOString())
      .order('started_at', { ascending: false });
    if (data) setRecentSessions(data);
  }, [user]);

  useEffect(() => {
    fetchCategories();
    fetchRecentSessions();
  }, [fetchCategories, fetchRecentSessions]);

  // ── Overview fetch ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (activeView !== 'overzicht' || !user || user.id === 'dev') return;
    setLoadingOverview(true);
    const { start, end } = getWeekRange(weekOffset);
    const { start: prevStart, end: prevEnd } = getWeekRange(weekOffset - 1);
    Promise.all([
      supabase.from('timer_sessions').select('*').eq('user_id', user.id)
        .gte('started_at', start.toISOString()).lte('started_at', end.toISOString()),
      supabase.from('timer_sessions').select('*').eq('user_id', user.id)
        .gte('started_at', prevStart.toISOString()).lte('started_at', prevEnd.toISOString()),
    ]).then(([curr, prev]) => {
      if (curr.data) setOverzichtSessions(curr.data);
      if (prev.data) setPrevSessions(prev.data);
      setLoadingOverview(false);
    });
  }, [activeView, weekOffset, user]);

  // ── Timer interval ────────────────────────────────────────────────────────────

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopInterval = useCallback(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  }, []);

  const startInterval = useCallback(() => {
    stopInterval();
    intervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
      const remaining = plannedSecsRef.current - elapsed;
      if (remaining <= 0 && !isOvertimeRef.current) {
        isOvertimeRef.current = true;
        setIsOvertime(true);
        haptic('success');
      }
      setDisplaySecs(remaining);
      setProgressFraction(1);
    }, 500);
  }, [stopInterval]);

  // ── Break interval ────────────────────────────────────────────────────────────

  const breakIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startBreakInterval = useCallback(() => {
    if (breakIntervalRef.current) clearInterval(breakIntervalRef.current);
    breakIntervalRef.current = setInterval(() => {
      const elapsed = (Date.now() - breakStartedAtRef.current) / 1000;
      const remaining = Math.max(0, breakPlannedSecsRef.current - elapsed);
      setBreakDisplaySecs(remaining);
      if (remaining <= 0) {
        clearInterval(breakIntervalRef.current!);
        breakIntervalRef.current = null;
        handleResumeFromBreak();
      }
    }, 500);
  }, []);

  // ── AppState handler (timer continues through background) ─────────────────────

  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      if (state !== 'active') return;
      if (phase === 'running' && startedAtMsRef.current) {
        const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
        const remaining = Math.max(0, plannedSecsRef.current - elapsed);
        setDisplaySecs(remaining);
        setProgressFraction(Math.min(1, elapsed / plannedSecsRef.current));
      }
      if (phase === 'paused' && breakStartedAtRef.current) {
        const elapsed = (Date.now() - breakStartedAtRef.current) / 1000;
        setBreakDisplaySecs(Math.max(0, breakPlannedSecsRef.current - elapsed));
      }
    });
    return () => sub.remove();
  }, [phase]);

  // ── Reflect countdown ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== 'reflecting') return;
    const id = setInterval(() => {
      setReflectCountdown(prev => {
        if (prev <= 1) { clearInterval(id); submitReflection(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [phase]);

  // ── Computed ──────────────────────────────────────────────────────────────────

  const streak = useMemo(() => computeTimerStreak(recentSessions), [recentSessions]);

  const selectedCategory = useMemo(
    () => categories.find(c => c.id === selectedCategoryId) ?? null,
    [categories, selectedCategoryId],
  );

  const weekRange = useMemo(() => getWeekRange(weekOffset), [weekOffset]);

  const overviewStats = useMemo(() => {
    const completed = overzichtSessions.filter(s => s.status === 'completed');
    const prevCompleted = prevSessions.filter(s => s.status === 'completed');

    const totalSecs = completed.reduce((sum, s) => sum + (s.actual_duration ?? 0), 0);
    const prevTotalSecs = prevCompleted.reduce((sum, s) => sum + (s.actual_duration ?? 0), 0);
    const avgPerDay = totalSecs / 7;
    const prevAvgPerDay = prevTotalSecs / 7;

    const byHour = Array.from({ length: 24 }, (_, h) => ({
      hour: h,
      secs: completed
        .filter(s => new Date(s.started_at).getHours() === h)
        .reduce((sum, s) => sum + (s.actual_duration ?? 0), 0),
    }));
    const activeHours = byHour.filter(h => h.secs > 0);
    const bestHour = activeHours.length > 0 ? activeHours.reduce((a, b) => b.secs > a.secs ? b : a) : null;
    const worstHour = activeHours.length > 0 ? activeHours.reduce((a, b) => a.secs < b.secs ? a : b) : null;

    const totalPauseSecs = completed.reduce((sum, s) => {
      const breakFraction = (s.planned_duration ?? 0) > 0
        ? Math.max(0, (s.planned_duration ?? 0) - (s.actual_duration ?? 0))
        : 0;
      return sum + breakFraction;
    }, 0);
    const pauseRatio = totalSecs > 0 ? totalPauseSecs / totalSecs : 0;

    const moods: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    completed.forEach(s => { if (s.mood_score) moods[s.mood_score] = (moods[s.mood_score] ?? 0) + 1; });

    const catDistribution = categories.map(cat => ({
      ...cat,
      secs: completed.filter(s => s.category_id === cat.id).reduce((sum, s) => sum + (s.actual_duration ?? 0), 0),
      count: completed.filter(s => s.category_id === cat.id).length,
    })).filter(c => c.secs > 0).sort((a, b) => b.secs - a.secs);

    const totalChange = prevTotalSecs > 0 ? ((totalSecs - prevTotalSecs) / prevTotalSecs) * 100 : null;
    const avgChange = prevAvgPerDay > 0 ? ((avgPerDay - prevAvgPerDay) / prevAvgPerDay) * 100 : null;

    // Daily distribution for bar chart
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekRange.start);
      d.setDate(d.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      const daySessions = completed.filter(s => s.started_at.startsWith(ds));
      return {
        label: WEEK_DAY_LABELS[i],
        secs: daySessions.reduce((sum, s) => sum + (s.actual_duration ?? 0), 0),
        sessions: daySessions,
      };
    });
    const maxDaySecs = Math.max(...days.map(d => d.secs), 1);

    return { totalSecs, avgPerDay, bestHour, worstHour, totalPauseSecs, pauseRatio, moods, catDistribution, totalChange, avgChange, days, maxDaySecs };
  }, [overzichtSessions, prevSessions, categories, weekRange]);

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function cancelScheduledNotif() {
    if (scheduledNotifIdRef.current) {
      Notifications.cancelScheduledNotificationAsync(scheduledNotifIdRef.current).catch(() => {});
      scheduledNotifIdRef.current = null;
    }
  }

  async function handleStart() {
    if (!user || user.id === 'dev') { showToast('Geen gebruiker gevonden', 'error'); return; }
    haptic('medium');
    const plannedSecs = plannedMins * 60;
    plannedSecsRef.current = plannedSecs;
    startedAtMsRef.current = Date.now();
    totalPausedMsRef.current = 0;
    isOvertimeRef.current = false;
    setIsOvertime(false);

    setDisplaySecs(plannedSecs);
    setProgressFraction(0);
    setPhase('running');
    startInterval();

    // Schedule end notification
    try {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status === 'granted') {
        const notifId = await Notifications.scheduleNotificationAsync({
          content: { title: 'Sous Chef ⏱️', body: "Hey Chef, time's up!", sound: true },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: plannedSecs, repeats: false },
        });
        scheduledNotifIdRef.current = notifId;
      }
    } catch {}

    // Persist session
    try {
      const { data } = await supabase.from('timer_sessions').insert({
        user_id: user.id,
        category_id: selectedCategoryId,
        task_name: intent.trim() || null,
        planned_duration: plannedSecs,
        status: 'running',
        started_at: new Date(startedAtMsRef.current).toISOString(),
      }).select('id').single();
      if (data) sessionIdRef.current = data.id;
    } catch {}
  }

  function handleFinishOvertime() {
    stopInterval();
    cancelScheduledNotif();
    const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
    setActualDurationSecs(Math.ceil(elapsed));
    setMoodScore(null);
    setReflectionNote('');
    setReflectCountdown(60);
    isOvertimeRef.current = false;
    setIsOvertime(false);
    setPhase('reflecting');
    haptic('success');
  }

  function handleFinishSession() {
    stopInterval();
    cancelScheduledNotif();
    setSessionOptionsVisible(false);
    const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
    setActualDurationSecs(Math.ceil(elapsed));
    setMoodScore(null);
    setReflectionNote('');
    setReflectCountdown(60);
    haptic('success');
    setTimeout(() => setPhase('reflecting'), 300);
  }

  function handleTakeBreak() {
    stopInterval();
    cancelScheduledNotif();
    setSessionOptionsVisible(false);
    pausedAtMsRef.current = Date.now();
    breakStartedAtRef.current = Date.now();
    breakPlannedSecsRef.current = settings.timer_break_minutes * 60;
    setBreakDisplaySecs(settings.timer_break_minutes * 60);
    setPauseMoodScore(null);
    haptic('light');

    // Persist break
    if (sessionIdRef.current && user && user.id !== 'dev') {
      supabase.from('timer_breaks').insert({
        session_id: sessionIdRef.current,
        planned_duration: breakPlannedSecsRef.current,
        started_at: new Date().toISOString(),
      }).select('id').single().then(({ data }) => {
        if (data) breakIdRef.current = data.id;
      });
    }

    setPhase('paused');
    startBreakInterval();
  }

  async function handleResumeFromBreak() {
    if (breakIntervalRef.current) { clearInterval(breakIntervalRef.current); breakIntervalRef.current = null; }

    // End break in DB
    if (breakIdRef.current && user && user.id !== 'dev') {
      const breakDuration = Date.now() - pausedAtMsRef.current;
      await supabase.from('timer_breaks').update({
        actual_duration: Math.ceil(breakDuration / 1000),
        ended_at: new Date().toISOString(),
      }).eq('id', breakIdRef.current);
      breakIdRef.current = null;
    }

    // Complete old session with elapsed time
    if (sessionIdRef.current && user && user.id !== 'dev') {
      const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
      await supabase.from('timer_sessions').update({
        status: 'completed',
        actual_duration: Math.ceil(elapsed),
        ended_at: new Date().toISOString(),
      }).eq('id', sessionIdRef.current);
      sessionIdRef.current = null;
    }

    // Start a fresh new session
    handleStart();
  }

  function handleAbandon() {
    stopInterval();
    cancelScheduledNotif();
    setSessionOptionsVisible(false);
    setAbandonReason(null);
    setAbandonNote('');
    haptic('light');
    setTimeout(() => setPhase('abandoning'), 300);
  }

  async function confirmAbandon(skip = false) {
    haptic('light');
    if (sessionIdRef.current && user && user.id !== 'dev') {
      const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
      await supabase.from('timer_sessions').update({
        status: 'abandoned',
        actual_duration: Math.ceil(elapsed),
        abandon_reason: skip ? null : (abandonReason ?? null),
        abandon_note: !skip && abandonReason === 'other' ? abandonNote.trim() || null : null,
        ended_at: new Date().toISOString(),
      }).eq('id', sessionIdRef.current);
    }
    sessionIdRef.current = null;
    resetToSetup();
    fetchRecentSessions();
  }

  async function submitReflection() {
    if (sessionIdRef.current && user && user.id !== 'dev') {
      await supabase.from('timer_sessions').update({
        status: 'completed',
        actual_duration: actualDurationSecs,
        mood_score: moodScore,
        reflection_note: reflectionNote.trim() || null,
        ended_at: new Date().toISOString(),
      }).eq('id', sessionIdRef.current);
    }
    sessionIdRef.current = null;
    haptic('success');
    showToast('Sessie opgeslagen! Pauze gestart.', 'success');
    fetchRecentSessions();
    // Auto-start break
    breakStartedAtRef.current = Date.now();
    breakPlannedSecsRef.current = settings.timer_break_minutes * 60;
    setBreakDisplaySecs(settings.timer_break_minutes * 60);
    setPauseMoodScore(null);
    setPhase('paused');
    startBreakInterval();
  }

  function resetToSetup() {
    stopInterval();
    cancelScheduledNotif();
    if (breakIntervalRef.current) { clearInterval(breakIntervalRef.current); breakIntervalRef.current = null; }
    isOvertimeRef.current = false;
    setIsOvertime(false);
    setPhase('setup');
    setProgressFraction(0);
    setDisplaySecs(plannedMins * 60);
    setIntent('');
    setMoodScore(null);
    setReflectionNote('');
    setAbandonReason(null);
    setAbandonNote('');
  }

  function adjustPlannedDuration(deltaMinutes: number) {
    haptic('light');
    const newMins = Math.max(5, Math.min(120, Math.round(plannedSecsRef.current / 60) + deltaMinutes));
    plannedSecsRef.current = newMins * 60;
    // Keep progressFraction stable, just update display
    const elapsed = (Date.now() - startedAtMsRef.current - totalPausedMsRef.current) / 1000;
    const newRemaining = Math.max(0, newMins * 60 - elapsed);
    setDisplaySecs(newRemaining);
    setProgressFraction(Math.min(1, elapsed / (newMins * 60)));
  }

  // ── Category CRUD ─────────────────────────────────────────────────────────────

  function openCatForm(cat: TimerCategory | null) {
    setEditingCategory(cat);
    setCatName(cat?.name ?? '');
    setCatColor(cat?.color ?? CATEGORY_COLORS[0]);
    setCatFormVisible(true);
  }

  async function saveCategory() {
    if (!user || user.id === 'dev' || !catName.trim()) return;
    setCatSaving(true);
    if (editingCategory) {
      await supabase.from('timer_categories').update({ name: catName.trim(), color: catColor }).eq('id', editingCategory.id);
    } else {
      await supabase.from('timer_categories').insert({
        user_id: user.id, name: catName.trim(), color: catColor, sort_order: categories.length,
      });
    }
    setCatFormVisible(false);
    setCatSaving(false);
    fetchCategories();
    showToast(editingCategory ? 'Categorie bijgewerkt' : 'Categorie toegevoegd', 'success');
  }

  async function deleteCategory(id: string) {
    await supabase.from('timer_categories').delete().eq('id', id);
    if (selectedCategoryId === id) setSelectedCategoryId(null);
    fetchCategories();
    showToast('Categorie verwijderd', 'info');
  }

  // ── Render helpers ────────────────────────────────────────────────────────────

  const runningElapsedMins = useMemo(() => {
    const elapsed = plannedSecsRef.current - displaySecs;
    return Math.max(0, Math.round(elapsed / 60));
  }, [displaySecs]);

  // ── Render ────────────────────────────────────────────────────────────────────

  const isActiveSession = phase !== 'setup';

  return (
    <View style={[s.root, { backgroundColor: phase === 'paused' ? '#1A1614' : colors.offWhite }]}>

      {/* ── SETUP + OVERZICHT header ─────────────────────────────────────────── */}
      {!isActiveSession && (
        <View style={[s.header, { paddingTop: insets.top + 14, backgroundColor: colors.offWhite }]}>
          {/* Streak badge */}
          {streak > 0 && (
            <View style={s.streakBadge}>
              <Text style={s.streakText}>🔥 {streak} dag{streak === 1 ? '' : 'en'} op rij</Text>
            </View>
          )}
          <View style={s.headerRow}>
            <TouchableOpacity onPress={() => setCatManagerVisible(true)} style={s.headerIconBtn} activeOpacity={0.75}>
              <Ionicons name="options-outline" size={22} color={colors.gray400} />
            </TouchableOpacity>
            <Text style={[s.headerTitle, { color: colors.black }]}>Timer</Text>
            <TouchableOpacity onPress={() => setSessionPrefsVisible(true)} style={s.headerIconBtn} activeOpacity={0.75}>
              <Ionicons name="settings-outline" size={22} color={colors.gray400} />
            </TouchableOpacity>
          </View>
          {/* Sub-tab toggle */}
          <View style={[s.subTabRow, { backgroundColor: colors.gray100 }]}>
            {(['timer', 'overzicht'] as const).map(v => (
              <TouchableOpacity
                key={v}
                onPress={() => { haptic('light'); setActiveView(v); }}
                style={[s.subTab, activeView === v && { backgroundColor: colors.white }]}
                activeOpacity={0.75}
              >
                <Text style={[s.subTabText, { color: activeView === v ? colors.black : colors.gray400 }]}>
                  {v === 'timer' ? 'Timer' : 'Overzicht'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* ── ACTIVE SESSION header ────────────────────────────────────────────── */}
      {isActiveSession && phase !== 'reflecting' && phase !== 'abandoning' && (
        <View style={[s.runningHeader, { paddingTop: insets.top + 14 }]}>
          {streak > 0 && (
            <Text style={[s.streakTextRunning, { color: phase === 'paused' ? 'rgba(244,239,228,0.6)' : colors.gray400 }]}>
              🔥 {streak}
            </Text>
          )}
        </View>
      )}

      {/* ═══════════════════════ TIMER VIEW ════════════════════════════════════ */}

      {activeView === 'timer' && phase === 'setup' && (
        <ScrollView
          style={s.container}
          contentContainerStyle={[s.setupContent, { paddingBottom: TAB_BAR_CLEARANCE }]}
          keyboardShouldPersistTaps="handled"
        >
          {/* Category picker */}
          <View style={{ alignItems: 'flex-start', marginBottom: 16 }}>
            <CategoryPill
              category={selectedCategory}
              onPress={() => setCatPickerVisible(true)}
            />
          </View>

          {/* Intent input */}
          <View style={[s.intentCard, { backgroundColor: colors.white }]}>
            <TextInput
              style={[s.intentInput, { color: colors.black }]}
              placeholder="Wat ga je doen?"
              placeholderTextColor={colors.gray400}
              value={intent}
              onChangeText={setIntent}
              selectionColor={Colors.yellow}
              returnKeyType="done"
              multiline
            />
          </View>

          {/* Duration picker */}
          <View style={[s.durationRow, { backgroundColor: colors.white }]}>
            <TouchableOpacity
              onPress={() => { setPlannedMins(m => Math.max(5, m - 5)); }}
              style={s.durationBtn}
              activeOpacity={0.75}
            >
              <Ionicons name="remove" size={22} color={colors.gray400} />
            </TouchableOpacity>
            <View style={{ alignItems: 'center' }}>
              <Text style={[s.durationValue, { color: colors.black }]}>{plannedMins} min</Text>
              <Text style={[s.durationLabel, { color: colors.gray400 }]}>Sessieduur</Text>
            </View>
            <TouchableOpacity
              onPress={() => { setPlannedMins(m => Math.min(120, m + 5)); }}
              style={s.durationBtn}
              activeOpacity={0.75}
            >
              <Ionicons name="add" size={22} color={colors.gray400} />
            </TouchableOpacity>
          </View>

          {/* Start button */}
          <TouchableOpacity onPress={handleStart} activeOpacity={0.85} style={s.startBtnWrap}>
            <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={s.startBtn}>
              <Ionicons name="play" size={26} color={Colors.black} />
              <Text style={s.startBtnText}>Starten</Text>
            </LinearGradient>
          </TouchableOpacity>

          {/* Recent sessions note */}
          {recentSessions.length > 0 && (
            <Text style={[s.recentNote, { color: colors.gray400 }]}>
              {recentSessions.filter(s => s.status === 'completed').length} sessies voltooid
            </Text>
          )}
        </ScrollView>
      )}

      {/* ── RUNNING ─────────────────────────────────────────────────────────── */}
      {activeView === 'timer' && phase === 'running' && (
        <View style={[s.runningContainer, { paddingBottom: insets.bottom + 24 }]}>
          {/* Category pill */}
          <View style={{ marginBottom: 16 }}>
            <CategoryPill category={selectedCategory} small />
          </View>

          {/* Intent label */}
          {intent.trim() ? (
            <Text style={[s.runningIntent, { color: colors.gray400 }]} numberOfLines={1}>
              {intent.trim()}
            </Text>
          ) : null}

          {/* Circular timer */}
          <View style={s.timerWrap}>
            <CircularTimer
              fraction={progressFraction}
              displaySecs={Math.max(0, displaySecs)}
              color={isOvertime ? '#EF4444' : Colors.yellow}
              trackColor={colors.gray100}
              centerColor={colors.surface}
            />
            {isOvertime && (
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 28, color: '#EF4444' }}>
                    +{formatTime(Math.abs(displaySecs))}
                  </Text>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: '#EF444488', marginTop: 2 }}>overtime</Text>
                </View>
              </View>
            )}
          </View>

          {/* Duration adjuster — hidden during overtime */}
          {!isOvertime && (
            <View style={s.durationAdjRow}>
              <TouchableOpacity onPress={() => adjustPlannedDuration(-5)} style={[s.adjBtn, { backgroundColor: colors.gray100 }]} activeOpacity={0.75}>
                <Text style={[s.adjBtnText, { color: colors.gray400 }]}>−5 min</Text>
              </TouchableOpacity>
              <Text style={[s.adjLabel, { color: colors.gray400 }]}>
                {formatMins(plannedSecsRef.current)}
              </Text>
              <TouchableOpacity onPress={() => adjustPlannedDuration(5)} style={[s.adjBtn, { backgroundColor: colors.gray100 }]} activeOpacity={0.75}>
                <Text style={[s.adjBtnText, { color: colors.gray400 }]}>+5 min</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Afronden button — shown during overtime */}
          {isOvertime && (
            <TouchableOpacity onPress={handleFinishOvertime} activeOpacity={0.85} style={[s.startBtnWrap, { marginTop: 16 }]}>
              <LinearGradient colors={['#EF4444', '#DC2626']} style={s.startBtn}>
                <Text style={[s.startBtnText, { color: Colors.white }]}>Afronden</Text>
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* Action buttons */}
          <View style={s.actionRow}>
            <ActionButton
              icon={muted ? 'volume-mute' : 'volume-medium-outline'}
              label={muted ? 'Aan' : 'Stil'}
              onPress={() => { haptic('light'); setMuted(m => !m); }}
            />
            {!isOvertime && (
              <ActionButton
                icon="cafe-outline"
                label="Pauze"
                onPress={handleTakeBreak}
              />
            )}
            <ActionButton
              icon="ellipsis-horizontal"
              label="Meer"
              onPress={() => setSessionOptionsVisible(true)}
            />
          </View>
        </View>
      )}

      {/* ── PAUSED (BREAK) ──────────────────────────────────────────────────── */}
      {activeView === 'timer' && phase === 'paused' && (
        <View style={[s.pauseContainer, { paddingBottom: insets.bottom + 32 }]}>
          <Text style={s.pauseLabel}>Taking a break</Text>
          <Text style={s.pauseTimer}>{formatTime(breakDisplaySecs)}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4 }}>
            <Text style={s.pauseSub}>Pauze van {Math.round(breakPlannedSecsRef.current / 60)} min</Text>
            <TouchableOpacity
              onPress={() => {
                haptic('light');
                breakPlannedSecsRef.current += 60;
                setBreakDisplaySecs(prev => prev + 60);
              }}
              style={{ backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 }}
              activeOpacity={0.75}
            >
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: 'rgba(244,239,228,0.8)' }}>+ 1 min</Text>
            </TouchableOpacity>
          </View>

          {/* Quick mid-session mood check */}
          <View style={s.pauseMoodWrap}>
            <Text style={s.pauseMoodTitle}>Hoe was de sessie tot dusver?</Text>
            <View style={s.pauseMoodRow}>
              {MOOD_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.score}
                  onPress={() => { haptic('light'); setPauseMoodScore(opt.score); setMoodScore(opt.score); }}
                  style={[s.pauseMoodBtn, pauseMoodScore === opt.score && s.pauseMoodBtnActive]}
                  activeOpacity={0.75}
                >
                  <Text style={s.pauseMoodEmoji}>{opt.emoji}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <TouchableOpacity onPress={handleResumeFromBreak} style={s.resumeBtn} activeOpacity={0.85}>
            <LinearGradient colors={['#F5C033', '#D9A000']} style={s.resumeBtnGrad}>
              <Ionicons name="play" size={24} color="#1A1614" />
              <Text style={s.resumeBtnText}>Vroeger hervatten</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* ── REFLECTING ──────────────────────────────────────────────────────── */}
      {phase === 'reflecting' && (
        <KeyboardAvoidingView
          style={s.reflectContainer}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={{ backgroundColor: colors.white }}
            contentContainerStyle={[s.reflectContent, { paddingBottom: insets.bottom + 32 }]}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header */}
            <View style={s.reflectHeader}>
              <TouchableOpacity
                onPress={() => { stopInterval(); resetToSetup(); fetchRecentSessions(); }}
                style={[s.reflectCloseBtn, { backgroundColor: colors.gray100 }]}
                activeOpacity={0.75}
              >
                <Ionicons name="close" size={18} color={colors.black} />
              </TouchableOpacity>
            </View>

            {/* Auto-submit countdown bar */}
            <View style={[s.countdownTrack, { backgroundColor: colors.gray100 }]}>
              <View style={[s.countdownFill, { width: `${(reflectCountdown / 60) * 100}%` as any, backgroundColor: Colors.yellow }]} />
            </View>
            <Text style={[s.countdownText, { color: colors.gray400 }]}>
              Verstuurt automatisch in {reflectCountdown}s
            </Text>

            <Text style={[s.reflectTitle, { color: colors.black }]}>Hoe was deze sessie?</Text>

            {/* Mood selector */}
            <View style={s.moodRow}>
              {MOOD_OPTIONS.map(opt => (
                <TouchableOpacity
                  key={opt.score}
                  onPress={() => { haptic('light'); setMoodScore(opt.score); }}
                  style={[s.moodBtn, { backgroundColor: moodScore === opt.score ? Colors.yellow + '33' : colors.gray100, borderColor: moodScore === opt.score ? Colors.yellow : 'transparent' }]}
                  activeOpacity={0.75}
                >
                  <Text style={s.moodEmoji}>{opt.emoji}</Text>
                  <Text style={[s.moodLabel, { color: moodScore === opt.score ? Colors.yellowText : colors.gray400 }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Session summary */}
            <View style={[s.reflectSummary, { backgroundColor: colors.gray100 }]}>
              {selectedCategory && (
                <View style={s.reflectSummaryRow}>
                  <View style={[s.catDot, { backgroundColor: selectedCategory.color }]} />
                  <Text style={[s.reflectSummaryLabel, { color: colors.gray400 }]}>Categorie</Text>
                  <Text style={[s.reflectSummaryValue, { color: colors.black }]}>{selectedCategory.name}</Text>
                </View>
              )}
              {intent.trim() ? (
                <View style={s.reflectSummaryRow}>
                  <Ionicons name="create-outline" size={13} color={colors.gray400} />
                  <Text style={[s.reflectSummaryLabel, { color: colors.gray400 }]}>Intentie</Text>
                  <Text style={[s.reflectSummaryValue, { color: colors.black }]} numberOfLines={1}>{intent.trim()}</Text>
                </View>
              ) : null}
              <View style={s.reflectSummaryRow}>
                <Ionicons name="time-outline" size={13} color={colors.gray400} />
                <Text style={[s.reflectSummaryLabel, { color: colors.gray400 }]}>Duur</Text>
                <Text style={[s.reflectSummaryValue, { color: colors.black }]}>{formatMins(actualDurationSecs)}</Text>
              </View>
            </View>

            {/* Reflection note */}
            <TextInput
              style={[s.reflectInput, { color: colors.black, backgroundColor: colors.gray100, borderColor: colors.gray200 }]}
              placeholder="Vrije reflectie (optioneel)..."
              placeholderTextColor={colors.gray400}
              value={reflectionNote}
              onChangeText={setReflectionNote}
              multiline
              numberOfLines={4}
              selectionColor={Colors.yellow}
              textAlignVertical="top"
            />

            {/* Submit button */}
            <TouchableOpacity onPress={submitReflection} activeOpacity={0.85} style={s.startBtnWrap}>
              <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={s.startBtn}>
                <Text style={s.startBtnText}>Opslaan</Text>
              </LinearGradient>
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* ── ABANDONING ──────────────────────────────────────────────────────── */}
      {phase === 'abandoning' && (
        <View style={[s.abandonContainer, { backgroundColor: colors.offWhite, paddingBottom: insets.bottom + 32 }]}>
          <View style={[s.abandonCard, { backgroundColor: colors.white }]}>
            <Text style={[s.abandonTitle, { color: colors.black }]}>Waarom gestopt?</Text>
            <View style={s.abandonChips}>
              {ABANDON_REASONS.map(r => (
                <TouchableOpacity
                  key={r.key}
                  onPress={() => { haptic('light'); setAbandonReason(r.key); }}
                  style={[s.abandonChip, { backgroundColor: abandonReason === r.key ? Colors.yellow : colors.gray100 }]}
                  activeOpacity={0.75}
                >
                  <Text style={[s.abandonChipText, { color: abandonReason === r.key ? Colors.black : colors.gray400 }]}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {abandonReason === 'other' && (
              <TextInput
                style={[s.abandonNoteInput, { color: colors.black, backgroundColor: colors.gray100, borderColor: colors.gray200 }]}
                placeholder="Toelichting..."
                placeholderTextColor={colors.gray400}
                value={abandonNote}
                onChangeText={setAbandonNote}
                selectionColor={Colors.yellow}
                autoFocus
              />
            )}

            <TouchableOpacity
              onPress={() => confirmAbandon(false)}
              disabled={!abandonReason}
              activeOpacity={0.85}
              style={[s.abandonConfirmBtn, { opacity: abandonReason ? 1 : 0.4 }]}
            >
              <LinearGradient colors={['#EF4444', '#DC2626']} style={s.abandonConfirmGrad}>
                <Text style={s.abandonConfirmText}>Sessie afbreken</Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => confirmAbandon(true)} style={s.abandonSkipBtn} activeOpacity={0.6}>
              <Text style={[s.abandonSkipText, { color: colors.gray400 }]}>Overslaan</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ═══════════════════════ OVERZICHT VIEW ════════════════════════════════ */}

      {activeView === 'overzicht' && phase === 'setup' && (
        <ScrollView
          style={s.container}
          contentContainerStyle={[s.overzichtContent, { paddingBottom: TAB_BAR_CLEARANCE }]}
        >
          {/* Period navigation */}
          <View style={[s.periodNav, { backgroundColor: colors.white }]}>
            <TouchableOpacity onPress={() => setWeekOffset(o => o - 1)} style={s.periodNavBtn} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={20} color={colors.gray400} />
            </TouchableOpacity>
            <Text style={[s.periodLabel, { color: colors.black }]}>{weekRange.label}</Text>
            <TouchableOpacity
              onPress={() => setWeekOffset(o => Math.min(0, o + 1))}
              style={s.periodNavBtn}
              activeOpacity={weekOffset < 0 ? 0.7 : 0.3}
              disabled={weekOffset >= 0}
            >
              <Ionicons name="chevron-forward" size={20} color={weekOffset >= 0 ? colors.gray200 : colors.gray400} />
            </TouchableOpacity>
          </View>

          {loadingOverview ? (
            <ActivityIndicator size="large" color={Colors.yellow} style={{ marginTop: 40 }} />
          ) : overzichtSessions.filter(s => s.status === 'completed').length === 0 ? (
            <View style={s.emptyOverzicht}>
              <Text style={{ fontSize: 36, marginBottom: 12 }}>⏱</Text>
              <Text style={[s.emptyTitle, { color: colors.black }]}>Geen sessies</Text>
              <Text style={[s.emptyText, { color: colors.gray400 }]}>Start je eerste timer om statistieken te zien.</Text>
              <TouchableOpacity onPress={() => setActiveView('timer')} style={s.startBtnWrap} activeOpacity={0.85}>
                <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={[s.startBtn, { paddingHorizontal: 24 }]}>
                  <Text style={s.startBtnText}>Naar Timer</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {/* Stats grid */}
              <Text style={[s.sectionLabel, { color: colors.gray400 }]}>STATISTIEKEN</Text>
              <View style={s.statsGrid}>
                <StatsCard
                  label="Totale focustijd"
                  value={formatMins(overviewStats.totalSecs)}
                  change={overviewStats.totalChange}
                />
                <StatsCard
                  label="Gem. focus / dag"
                  value={formatMins(overviewStats.avgPerDay)}
                  change={overviewStats.avgChange}
                />
                <StatsCard
                  label="Best gefocust"
                  value={overviewStats.bestHour ? formatHourRange(overviewStats.bestHour.hour) : '—'}
                  sub={overviewStats.bestHour ? formatMins(overviewStats.bestHour.secs) : undefined}
                />
                <StatsCard
                  label="Totale pauzetijd"
                  value={formatMins(overviewStats.totalPauseSecs)}
                />
                <StatsCard
                  label="Focus / pauze"
                  value={overviewStats.pauseRatio > 0
                    ? `${Math.round(1 / overviewStats.pauseRatio)}:1`
                    : '—'}
                />
                <StatsCard
                  label="Minst gefocust"
                  value={overviewStats.worstHour ? formatHourRange(overviewStats.worstHour.hour) : '—'}
                  sub={overviewStats.worstHour ? formatMins(overviewStats.worstHour.secs) : undefined}
                />
              </View>

              {/* Mood mini-cards */}
              <Text style={[s.sectionLabel, { color: colors.gray400 }]}>STEMMING</Text>
              <View style={s.moodStatsRow}>
                {MOOD_OPTIONS.map(opt => (
                  <View key={opt.score} style={[s.moodStatCard, { backgroundColor: colors.white }]}>
                    <Text style={s.moodStatEmoji}>{opt.emoji}</Text>
                    <Text style={[s.moodStatCount, { color: colors.black }]}>{overviewStats.moods[opt.score] ?? 0}</Text>
                    <Text style={[s.moodStatLabel, { color: colors.gray400 }]}>{opt.label}</Text>
                  </View>
                ))}
              </View>

              {/* Daily bar chart */}
              <Text style={[s.sectionLabel, { color: colors.gray400 }]}>DAGVERDELING</Text>
              <View style={[s.chartCard, { backgroundColor: colors.white }]}>
                <View style={s.barChart}>
                  {overviewStats.days.map((day, i) => {
                    const barH = day.secs > 0 ? Math.max(4, (day.secs / overviewStats.maxDaySecs) * 100) : 0;
                    const catColor = day.sessions[0]?.category_id
                      ? (categories.find(c => c.id === day.sessions[0].category_id)?.color ?? Colors.yellow)
                      : Colors.yellow;
                    return (
                      <View key={i} style={s.barCol}>
                        <View style={s.barWrap}>
                          {barH > 0 ? (
                            <View style={[s.bar, { height: barH, backgroundColor: catColor }]} />
                          ) : (
                            <View style={[s.barEmpty, { backgroundColor: colors.gray100 }]} />
                          )}
                        </View>
                        <Text style={[s.barLabel, { color: colors.gray400 }]}>{day.label}</Text>
                        {day.secs > 0 && (
                          <Text style={[s.barValue, { color: colors.gray400 }]}>{Math.round(day.secs / 60)}m</Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>

              {/* Category distribution */}
              {overviewStats.catDistribution.length > 0 && (
                <>
                  <Text style={[s.sectionLabel, { color: colors.gray400 }]}>CATEGORIEËN</Text>
                  <View style={[s.catDistCard, { backgroundColor: colors.white }]}>
                    {overviewStats.catDistribution.map((cat, idx) => {
                      const totalCatSecs = overviewStats.catDistribution.reduce((sum, c) => sum + c.secs, 0);
                      const pct = totalCatSecs > 0 ? Math.round((cat.secs / totalCatSecs) * 100) : 0;
                      return (
                        <View key={cat.id}>
                          {idx > 0 && <View style={[s.divider, { backgroundColor: colors.gray100 }]} />}
                          <View style={s.catDistRow}>
                            <View style={[s.catDot, { backgroundColor: cat.color, width: 10, height: 10, borderRadius: 5 }]} />
                            <Text style={[s.catDistName, { color: colors.black }]}>{cat.name}</Text>
                            <Text style={[s.catDistPct, { color: colors.gray400 }]}>{pct}%</Text>
                            <Text style={[s.catDistTime, { color: colors.gray400 }]}>{formatMins(cat.secs)}</Text>
                          </View>
                          <View style={[s.catDistTrack, { backgroundColor: colors.gray100 }]}>
                            <View style={[s.catDistFill, { width: `${pct}%` as any, backgroundColor: cat.color }]} />
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </>
              )}

              {/* FAB to start new session */}
              <TouchableOpacity
                onPress={() => setActiveView('timer')}
                style={[s.fab, { bottom: TAB_BAR_CLEARANCE - 12 }]}
                activeOpacity={0.85}
              >
                <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={s.fabGrad}>
                  <Ionicons name="add" size={26} color={Colors.black} />
                </LinearGradient>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      )}

      {/* ═══════════════════ MODALS ════════════════════════════════════════════ */}

      {/* Session options bottom sheet */}
      <Modal
        visible={sessionOptionsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSessionOptionsVisible(false)}
      >
        <Pressable style={s.sheetOverlay} onPress={() => setSessionOptionsVisible(false)}>
          <Pressable onPress={() => {}} style={[s.sheetCard, { backgroundColor: colors.white }]}>
            <View style={[s.sheetHandle, { backgroundColor: colors.gray200 }]} />

            <TouchableOpacity
              onPress={handleFinishSession}
              style={s.sheetRow}
              activeOpacity={0.75}
            >
              <View style={[s.sheetRowIcon, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="checkmark-circle-outline" size={22} color="#22C55E" />
              </View>
              <Text style={[s.sheetRowText, { color: colors.black }]}>Sessie afronden</Text>
            </TouchableOpacity>

            <View style={[s.divider, { backgroundColor: colors.gray100 }]} />

            <TouchableOpacity
              onPress={handleTakeBreak}
              style={s.sheetRow}
              activeOpacity={0.75}
            >
              <View style={[s.sheetRowIcon, { backgroundColor: colors.gray100 }]}>
                <Ionicons name="cafe-outline" size={22} color={colors.gray400} />
              </View>
              <Text style={[s.sheetRowText, { color: colors.black }]}>Pauze nemen</Text>
            </TouchableOpacity>

            <View style={[s.divider, { backgroundColor: colors.gray100 }]} />

            <TouchableOpacity
              onPress={handleAbandon}
              style={s.sheetRow}
              activeOpacity={0.75}
            >
              <View style={[s.sheetRowIcon, { backgroundColor: '#FEE2E2' }]}>
                <Ionicons name="close-circle-outline" size={22} color="#EF4444" />
              </View>
              <Text style={[s.sheetRowText, { color: '#EF4444' }]}>Sessie afbreken</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Category picker bottom sheet */}
      <Modal
        visible={catPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setCatPickerVisible(false)}
      >
        <Pressable style={s.sheetOverlay} onPress={() => setCatPickerVisible(false)}>
          <Pressable onPress={() => {}} style={[s.sheetCard, { backgroundColor: colors.white }]}>
            <View style={[s.sheetHandle, { backgroundColor: colors.gray200 }]} />
            <Text style={[s.sheetTitle, { color: colors.black }]}>Categorie</Text>

            <TouchableOpacity
              onPress={() => { haptic('light'); setSelectedCategoryId(null); setCatPickerVisible(false); }}
              style={[s.catPickerRow, selectedCategoryId === null && { backgroundColor: colors.gray100 }]}
              activeOpacity={0.75}
            >
              <View style={[s.catDot, { backgroundColor: colors.gray200 }]} />
              <Text style={[s.catPickerLabel, { color: colors.gray400 }]}>Geen categorie</Text>
              {selectedCategoryId === null && <Ionicons name="checkmark" size={18} color={Colors.yellow} />}
            </TouchableOpacity>

            {categories.map(cat => (
              <TouchableOpacity
                key={cat.id}
                onPress={() => { haptic('light'); setSelectedCategoryId(cat.id); setCatPickerVisible(false); }}
                style={[s.catPickerRow, selectedCategoryId === cat.id && { backgroundColor: colors.gray100 }]}
                activeOpacity={0.75}
              >
                <View style={[s.catDot, { backgroundColor: cat.color }]} />
                <Text style={[s.catPickerLabel, { color: colors.black }]}>{cat.name}</Text>
                {selectedCategoryId === cat.id && <Ionicons name="checkmark" size={18} color={Colors.yellow} />}
              </TouchableOpacity>
            ))}

            {categories.length === 0 && (
              <Text style={[s.catPickerEmpty, { color: colors.gray400 }]}>
                Geen categorieën. Tik op het sliders-icoon om er een toe te voegen.
              </Text>
            )}

            <TouchableOpacity
              onPress={() => { setCatPickerVisible(false); setTimeout(() => setCatManagerVisible(true), 300); }}
              style={[s.catPickerManage, { borderTopColor: colors.gray100 }]}
              activeOpacity={0.75}
            >
              <Ionicons name="options-outline" size={16} color={Colors.yellow} />
              <Text style={[s.catPickerManageText, { color: Colors.yellowText }]}>Categorieën beheren</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Category manager modal */}
      <Modal
        visible={catManagerVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCatManagerVisible(false)}
      >
        <View style={[s.modal, { backgroundColor: colors.offWhite }]}>
          <View style={[s.modalHeader, { borderBottomColor: colors.gray100, backgroundColor: colors.white }]}>
            <TouchableOpacity
              onPress={() => setCatManagerVisible(false)}
              style={[s.modalCloseBtn, { backgroundColor: colors.gray100 }]}
              activeOpacity={0.75}
            >
              <Text style={[s.modalCloseTxt, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[s.modalTitle, { color: colors.black }]}>Categorieën</Text>
            <View style={{ width: 72 }} />
          </View>

          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
            {categories.length === 0 && (
              <Text style={[s.catPickerEmpty, { color: colors.gray400, textAlign: 'center', marginVertical: 24 }]}>
                Nog geen categorieën aangemaakt.
              </Text>
            )}
            {categories.map(cat => (
              <View key={cat.id} style={[s.catManagerRow, { backgroundColor: colors.white }]}>
                <View style={[s.catDot, { backgroundColor: cat.color, width: 14, height: 14, borderRadius: 7 }]} />
                <Text style={[s.catManagerName, { color: colors.black }]}>{cat.name}</Text>
                <TouchableOpacity onPress={() => openCatForm(cat)} style={{ padding: 6 }} activeOpacity={0.7}>
                  <Text style={[s.catManagerEdit, { color: Colors.yellowText }]}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => deleteCategory(cat.id)} style={{ padding: 6 }} activeOpacity={0.7}>
                  <Ionicons name="trash-outline" size={16} color="#EF4444" />
                </TouchableOpacity>
              </View>
            ))}

            <TouchableOpacity
              onPress={() => openCatForm(null)}
              style={[s.addCatBtn, { borderColor: Colors.yellow }]}
              activeOpacity={0.85}
            >
              <Ionicons name="add" size={18} color={Colors.yellowText} />
              <Text style={[s.addCatBtnText, { color: Colors.yellowText }]}>NIEUWE CATEGORIE</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>

        {/* Category form nested modal */}
        <Modal
          visible={catFormVisible}
          animationType="slide"
          presentationStyle="formSheet"
          onRequestClose={() => setCatFormVisible(false)}
        >
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
            <View style={[s.modal, { backgroundColor: colors.white }]}>
              <View style={[s.modalHeader, { borderBottomColor: colors.gray100 }]}>
                <TouchableOpacity
                  onPress={() => setCatFormVisible(false)}
                  style={[s.modalCloseBtn, { backgroundColor: colors.gray100 }]}
                  activeOpacity={0.75}
                >
                  <Text style={[s.modalCloseTxt, { color: colors.gray400 }]}>Annuleer</Text>
                </TouchableOpacity>
                <Text style={[s.modalTitle, { color: colors.black }]}>
                  {editingCategory ? 'Bewerk categorie' : 'Nieuwe categorie'}
                </Text>
                <TouchableOpacity
                  onPress={saveCategory}
                  disabled={catSaving || !catName.trim()}
                  style={[s.modalCloseBtn, { backgroundColor: Colors.yellow, opacity: catName.trim() ? 1 : 0.4 }]}
                  activeOpacity={0.85}
                >
                  {catSaving
                    ? <ActivityIndicator size="small" color={Colors.black} />
                    : <Text style={[s.modalCloseTxt, { color: Colors.black }]}>Opslaan</Text>}
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }}>
                <View style={{ gap: 8 }}>
                  <Text style={[s.formLabel, { color: colors.gray400 }]}>Snelle keuze</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    {[['💼','Werk'],['🏋️','Sport'],['📚','Studie'],['🎵','Muziek'],['🧘','Rust'],['🍳','Koken'],['🎨','Creatief'],['💻','Coderen']].map(([emoji, name]) => (
                      <TouchableOpacity
                        key={name}
                        onPress={() => setCatName(`${emoji} ${name}`)}
                        style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: catName === `${emoji} ${name}` ? Colors.yellow : colors.gray100, flexDirection: 'row', alignItems: 'center', gap: 6 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontSize: 15 }}>{emoji}</Text>
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: catName === `${emoji} ${name}` ? Colors.black : colors.gray400 }}>{name}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={[s.formLabel, { color: colors.gray400 }]}>Naam</Text>
                  <TextInput
                    style={[s.formInput, { borderColor: colors.gray200, backgroundColor: colors.offWhite, color: colors.black }]}
                    value={catName}
                    onChangeText={setCatName}
                    placeholder="Bijv. 💼 Werk, 🏋️ Sport..."
                    placeholderTextColor={colors.gray400}
                    autoFocus
                    selectionColor={Colors.yellow}
                  />
                </View>
                <View style={{ gap: 8 }}>
                  <Text style={[s.formLabel, { color: colors.gray400 }]}>Kleur</Text>
                  <View style={s.colorGrid}>
                    {CATEGORY_COLORS.map(col => (
                      <TouchableOpacity
                        key={col}
                        onPress={() => { haptic('light'); setCatColor(col); }}
                        style={[s.colorSwatch, { backgroundColor: col, borderWidth: catColor === col ? 3 : 0, borderColor: colors.black }]}
                        activeOpacity={0.8}
                      />
                    ))}
                  </View>
                </View>
              </ScrollView>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      </Modal>

      {/* Session preferences modal */}
      <Modal
        visible={sessionPrefsVisible}
        animationType="slide"
        presentationStyle="formSheet"
        onRequestClose={() => setSessionPrefsVisible(false)}
      >
        <View style={[s.modal, { backgroundColor: colors.white }]}>
          <View style={[s.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity
              onPress={() => setSessionPrefsVisible(false)}
              style={[s.modalCloseBtn, { backgroundColor: colors.gray100 }]}
              activeOpacity={0.75}
            >
              <Text style={[s.modalCloseTxt, { color: colors.gray400 }]}>Sluiten</Text>
            </TouchableOpacity>
            <Text style={[s.modalTitle, { color: colors.black }]}>Sessie-instellingen</Text>
            <View style={{ width: 72 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 24 }}>
            {/* Default duration */}
            <View style={{ gap: 8 }}>
              <Text style={[s.formLabel, { color: colors.gray400 }]}>Standaard sessieduur</Text>
              <View style={[s.durationRow, { backgroundColor: colors.gray100, borderRadius: Radius.md }]}>
                <TouchableOpacity
                  onPress={() => { const v = Math.max(5, settings.timer_default_minutes - 5); updateSetting('timer_default_minutes', v); setPlannedMins(v); }}
                  style={s.durationBtn} activeOpacity={0.75}
                >
                  <Ionicons name="remove" size={22} color={colors.gray400} />
                </TouchableOpacity>
                <Text style={[s.durationValue, { color: colors.black }]}>{settings.timer_default_minutes} min</Text>
                <TouchableOpacity
                  onPress={() => { const v = Math.min(120, settings.timer_default_minutes + 5); updateSetting('timer_default_minutes', v); setPlannedMins(v); }}
                  style={s.durationBtn} activeOpacity={0.75}
                >
                  <Ionicons name="add" size={22} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            </View>

            {/* Break duration */}
            <View style={{ gap: 8 }}>
              <Text style={[s.formLabel, { color: colors.gray400 }]}>Standaard pauze</Text>
              <View style={[s.durationRow, { backgroundColor: colors.gray100, borderRadius: Radius.md }]}>
                <TouchableOpacity
                  onPress={() => updateSetting('timer_break_minutes', Math.max(1, settings.timer_break_minutes - 1))}
                  style={s.durationBtn} activeOpacity={0.75}
                >
                  <Ionicons name="remove" size={22} color={colors.gray400} />
                </TouchableOpacity>
                <Text style={[s.durationValue, { color: colors.black }]}>{settings.timer_break_minutes} min</Text>
                <TouchableOpacity
                  onPress={() => updateSetting('timer_break_minutes', Math.min(30, settings.timer_break_minutes + 1))}
                  style={s.durationBtn} activeOpacity={0.75}
                >
                  <Ionicons name="add" size={22} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            </View>

            {/* DND placeholder */}
            <View style={[s.dndRow, { backgroundColor: colors.gray100, borderRadius: Radius.md }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[s.formLabel, { color: colors.black }]}>Niet storen tijdens sessie</Text>
                <Text style={[s.formSub, { color: colors.gray400 }]}>Systeemintegratie — komt binnenkort</Text>
              </View>
              <View style={[s.dndBadge, { backgroundColor: colors.gray200 }]}>
                <Text style={[s.dndBadgeText, { color: colors.gray400 }]}>binnenkort</Text>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <Toast {...toastProps} />
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },

  // ── Header ──
  header: { paddingHorizontal: 20, paddingBottom: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  headerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 27, textTransform: 'uppercase', letterSpacing: 0.4 },
  headerIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  streakBadge: { alignSelf: 'flex-start', backgroundColor: `${Colors.yellow}22`, borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 4, marginBottom: 10 },
  streakText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.yellowText },

  // ── Sub-tab ──
  subTabRow: { flexDirection: 'row', borderRadius: Radius.pill, padding: 3, marginHorizontal: 0, marginBottom: 4 },
  subTab: { flex: 1, paddingVertical: 7, borderRadius: Radius.pill, alignItems: 'center' },
  subTabText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // ── Setup ──
  setupContent: { paddingHorizontal: 20, paddingTop: 8, gap: 12 },
  intentCard: { borderRadius: Radius.lg, ...Shadow.card, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 14, minHeight: 80 },
  intentInput: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 24 },
  durationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: Radius.lg, paddingVertical: 12, paddingHorizontal: 8, ...Shadow.card },
  durationBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  durationValue: { fontFamily: 'Inter_700Bold', fontSize: 22, letterSpacing: -0.5 },
  durationLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  startBtnWrap: { borderRadius: Radius.pill, overflow: 'hidden', alignSelf: 'center', marginTop: 8 },
  startBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 40, paddingVertical: 16, borderRadius: Radius.pill },
  startBtnText: { fontFamily: 'Inter_700Bold', fontSize: 17, color: Colors.black },
  recentNote: { fontFamily: 'Inter_300Light', fontSize: 12, textAlign: 'center', marginTop: 4 },

  // ── Category pill ──
  catPill: { flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1 },
  catPillSmall: { paddingHorizontal: 10, paddingVertical: 5 },
  catDot: { width: 8, height: 8, borderRadius: 4 },
  catDotSmall: { width: 6, height: 6, borderRadius: 3 },
  catPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  catPillTextSmall: { fontSize: 12 },

  // ── Running ──
  runningContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  runningHeader: { alignItems: 'center', paddingHorizontal: 20 },
  streakTextRunning: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  runningIntent: { fontFamily: 'Inter_400Regular', fontSize: 14, marginBottom: 8, maxWidth: 240, textAlign: 'center' },
  timerWrap: { marginVertical: 16 },
  timerDisplay: { fontFamily: 'Inter_700Bold', fontSize: 42, letterSpacing: -2 },

  // ── Duration adjuster ──
  durationAdjRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
  adjBtn: { borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 8 },
  adjBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  adjLabel: { fontFamily: 'Inter_400Regular', fontSize: 14, minWidth: 60, textAlign: 'center' },

  // ── Action buttons ──
  actionRow: { flexDirection: 'row', gap: 20, justifyContent: 'center' },
  actionBtn: { alignItems: 'center', gap: 6 },
  actionBtnInner: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  actionBtnLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },

  // ── Pause ──
  pauseContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  pauseLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: 'rgba(244,239,228,0.7)', letterSpacing: 0.3 },
  pauseTimer: { fontFamily: 'Inter_700Bold', fontSize: 64, color: '#F4EFE4', letterSpacing: -3, marginVertical: 8 },
  pauseSub: { fontFamily: 'Inter_300Light', fontSize: 14, color: 'rgba(244,239,228,0.5)', marginBottom: 32 },
  resumeBtn: { borderRadius: Radius.pill, overflow: 'hidden', marginTop: 16 },
  resumeBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 32, paddingVertical: 16 },
  resumeBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#1A1614' },
  pauseMoodWrap: { alignItems: 'center', gap: 10, marginTop: 24, marginBottom: 8 },
  pauseMoodTitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(244,239,228,0.55)', letterSpacing: 0.2 },
  pauseMoodRow: { flexDirection: 'row', gap: 16 },
  pauseMoodBtn: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  pauseMoodBtnActive: { backgroundColor: 'rgba(245,192,51,0.25)', borderWidth: 1.5, borderColor: '#F5C033' },
  pauseMoodEmoji: { fontSize: 26 },

  // ── Reflection ──
  reflectContainer: { flex: 1 },
  reflectContent: { padding: 20, gap: 16 },
  reflectHeader: { flexDirection: 'row', justifyContent: 'flex-end' },
  reflectCloseBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  countdownTrack: { height: 3, borderRadius: 2, overflow: 'hidden' },
  countdownFill: { height: '100%', borderRadius: 2 },
  countdownText: { fontFamily: 'Inter_300Light', fontSize: 11, textAlign: 'right', marginTop: 4 },
  reflectTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, letterSpacing: -0.4, lineHeight: 26 },
  moodRow: { flexDirection: 'row', gap: 10 },
  moodBtn: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: Radius.md, borderWidth: 1.5 },
  moodEmoji: { fontSize: 26, marginBottom: 4 },
  moodLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textAlign: 'center' },
  reflectSummary: { borderRadius: Radius.md, padding: 14, gap: 8 },
  reflectSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reflectSummaryLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, width: 60 },
  reflectSummaryValue: { fontFamily: 'Inter_600SemiBold', fontSize: 13, flex: 1 },
  reflectInput: { borderWidth: 1, borderRadius: Radius.md, padding: 14, minHeight: 100, fontFamily: 'Inter_400Regular', fontSize: 15, lineHeight: 22 },

  // ── Abandon ──
  abandonContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  abandonCard: { width: '100%', borderRadius: Radius.xl, padding: 24, gap: 16, ...Shadow.strong },
  abandonTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  abandonChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center' },
  abandonChip: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: Radius.pill },
  abandonChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  abandonNoteInput: { borderWidth: 1, borderRadius: Radius.md, padding: 12, fontFamily: 'Inter_400Regular', fontSize: 15 },
  abandonConfirmBtn: { borderRadius: Radius.pill, overflow: 'hidden' },
  abandonConfirmGrad: { paddingVertical: 14, alignItems: 'center', borderRadius: Radius.pill },
  abandonConfirmText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#fff' },
  abandonSkipBtn: { alignItems: 'center', paddingVertical: 8 },
  abandonSkipText: { fontFamily: 'Inter_400Regular', fontSize: 14 },

  // ── Session options sheet ──
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheetCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 16, paddingBottom: 40 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 8, paddingHorizontal: 4 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12, borderRadius: Radius.md },
  sheetRowIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  sheetRowText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },

  // ── Category picker ──
  catPickerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.md, marginVertical: 1 },
  catPickerLabel: { fontFamily: 'Inter_400Regular', fontSize: 16, flex: 1 },
  catPickerEmpty: { fontFamily: 'Inter_300Light', fontSize: 13, padding: 16 },
  catPickerManage: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, paddingHorizontal: 4, marginTop: 8, borderTopWidth: 1 },
  catPickerManageText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // ── Category manager ──
  catManagerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg, marginBottom: 8, ...Shadow.card },
  catManagerName: { fontFamily: 'Inter_600SemiBold', fontSize: 15, flex: 1 },
  catManagerEdit: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  addCatBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1.5, borderStyle: 'dashed', borderRadius: Radius.lg, paddingVertical: 16, marginTop: 8 },
  addCatBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 0.5 },

  // ── Modal ──
  modal: { flex: 1 },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  modalCloseBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.pill },
  modalCloseTxt: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // ── Form ──
  formLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  formSub: { fontFamily: 'Inter_300Light', fontSize: 12 },
  formInput: { borderWidth: 1, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 16 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  colorSwatch: { width: 36, height: 36, borderRadius: 18 },
  dndRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  dndBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: Radius.pill },
  dndBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },

  // ── Overview ──
  overzichtContent: { paddingHorizontal: 16, paddingTop: 8, gap: 6 },
  periodNav: { flexDirection: 'row', alignItems: 'center', borderRadius: Radius.lg, paddingHorizontal: 8, paddingVertical: 6, marginBottom: 8, ...Shadow.card },
  periodNavBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  periodLabel: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 14, textAlign: 'center' },
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.8, marginTop: 8, marginBottom: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statsCard: { width: '47%', borderRadius: Radius.lg, padding: 14, gap: 4, ...Shadow.card },
  statsCardLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  statsCardValue: { fontFamily: 'Inter_700Bold', fontSize: 18, letterSpacing: -0.4 },
  statsCardSub: { fontFamily: 'Inter_300Light', fontSize: 11 },
  statsCardChange: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginTop: 2 },
  moodStatsRow: { flexDirection: 'row', gap: 10 },
  moodStatCard: { flex: 1, borderRadius: Radius.lg, padding: 14, alignItems: 'center', gap: 4, ...Shadow.card },
  moodStatEmoji: { fontSize: 22 },
  moodStatCount: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  moodStatLabel: { fontFamily: 'Inter_300Light', fontSize: 10, textAlign: 'center' },
  chartCard: { borderRadius: Radius.lg, padding: 16, ...Shadow.card },
  barChart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 120, paddingTop: 8 },
  barCol: { flex: 1, alignItems: 'center', gap: 4 },
  barWrap: { flex: 1, justifyContent: 'flex-end', width: '100%', alignItems: 'center' },
  bar: { width: '80%', borderRadius: 4 },
  barEmpty: { width: '80%', height: 4, borderRadius: 2 },
  barLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10 },
  barValue: { fontFamily: 'Inter_300Light', fontSize: 9 },
  catDistCard: { borderRadius: Radius.lg, padding: 16, ...Shadow.card, gap: 10 },
  catDistRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  catDistName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, flex: 1 },
  catDistPct: { fontFamily: 'Inter_700Bold', fontSize: 13, minWidth: 36, textAlign: 'right' },
  catDistTime: { fontFamily: 'Inter_300Light', fontSize: 12, minWidth: 44, textAlign: 'right' },
  catDistTrack: { height: 4, borderRadius: 2, overflow: 'hidden', marginTop: 2 },
  catDistFill: { height: '100%', borderRadius: 2 },
  fab: { position: 'absolute', right: 16, width: 52, height: 52, borderRadius: 26, overflow: 'hidden', ...Shadow.yellow },
  fabGrad: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyOverzicht: { alignItems: 'center', paddingTop: 60, gap: 8, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 12 },

  // ── Shared ──
  divider: { height: 1, marginVertical: 2 },
});
