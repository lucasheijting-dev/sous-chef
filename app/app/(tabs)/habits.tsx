import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { Habit, HabitLog } from '@/lib/types';
import { Colors, Radius, Shadow } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { SkeletonHabitCard } from '@/components/SkeletonCard';
import { Toast, useToast } from '@/components/Toast';

// ── Constants ──────────────────────────────────────────────────────────────────

function haptic(style: 'light' | 'medium' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

const LEVELS = [
  { key: 'mini',  emoji: '🥉', label: 'Brons',  activeBg: '#78350F', activeFg: '#FEF3C7', pts: 1 },
  { key: 'good',  emoji: '🥈', label: 'Zilver', activeBg: '#1F2937', activeFg: '#F9FAFB', pts: 2 },
  { key: 'elite', emoji: '🥇', label: 'Goud',   activeBg: Colors.yellow, activeFg: Colors.black, pts: 3 },
] as const;

// Improvement #6: 14-day strip
const STRIP_DAYS = 14;
const today = new Date().toISOString().split('T')[0];

const MONTH_START = (() => {
  const d = new Date(); d.setDate(1);
  return d.toISOString().split('T')[0];
})();

const NINETY_DAYS_AGO = (() => {
  const d = new Date(); d.setDate(d.getDate() - 90);
  return d.toISOString().split('T')[0];
})();

function getDayStrip(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (count - 1 - i));
    return {
      date: d.toISOString().split('T')[0],
      day: d.toLocaleDateString('nl-NL', { weekday: 'short' }).slice(0, 2).toUpperCase(),
      num: String(d.getDate()),
    };
  });
}

const strip = getDayStrip(STRIP_DAYS);
const WEEK_DAYS_SHORT = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function dayLabel(dateKey: string): string {
  const d = new Date(dateKey + 'T00:00:00');
  const diff = Math.round((new Date(today + 'T00:00:00').getTime() - d.getTime()) / 86400000);
  if (diff === 0) return 'Vandaag';
  if (diff === 1) return 'Gisteren';
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

// Improvement #13: streak per habit
function computeStreak(habitId: string, logs: HabitLog[], endDate: string): number {
  const d = new Date(endDate + 'T00:00:00');
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    const ds = d.toISOString().split('T')[0];
    if (!logs.some(l => l.habit_id === habitId && l.date === ds)) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// Improvement #3: weekly score
function computeWeekScore(logs: HabitLog[]): number {
  const weekStart = strip[STRIP_DAYS - 7].date;
  return logs
    .filter(l => l.date >= weekStart && l.date <= today)
    .reduce((s, l) => s + (LEVELS.find(lv => lv.key === l.level)?.pts ?? 0), 0);
}

// Improvement #23: perfect days this month
function computePerfectDays(habits: Habit[], monthLogs: HabitLog[]): number {
  const now = new Date();
  let count = 0;
  for (let d = 1; d <= now.getDate(); d++) {
    const ds = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayLogs = monthLogs.filter(l => l.date === ds);
    if (dayLogs.length >= habits.length && habits.length > 0) count++;
  }
  return count;
}

// Improvement #24: current overall streak (all habits done)
function computeOverallStreak(habits: Habit[], logs: HabitLog[]): number {
  if (habits.length === 0) return 0;
  let streak = 0;
  const d = new Date(today + 'T00:00:00');
  for (let i = 0; i < 90; i++) {
    const ds = d.toISOString().split('T')[0];
    const dayLogs = logs.filter(l => l.date === ds);
    const allDone = habits.every(h => dayLogs.some(l => l.habit_id === h.id));
    if (!allDone) break;
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ── Spark Line — Improvement #14 ───────────────────────────────────────────────

function SparkLine({ habitId, logs }: { habitId: string; logs: HabitLog[] }) {
  const last7 = strip.slice(-7);
  return (
    <View style={spark.row}>
      {last7.map(day => {
        const log = logs.find(l => l.habit_id === habitId && l.date === day.date);
        const isFuture = day.date > today;
        const bg = isFuture ? 'transparent'
          : log?.level === 'elite' ? Colors.yellow
          : log?.level === 'good'  ? '#6B7280'
          : log?.level === 'mini'  ? '#92400E'
          : '#E0E0E0';
        const borderColor = isFuture ? '#E0E0E0' : bg;
        return (
          <View key={day.date} style={[spark.dot, { backgroundColor: bg, borderColor }]} />
        );
      })}
    </View>
  );
}

const spark = StyleSheet.create({
  row: { flexDirection: 'row', gap: 4, marginTop: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
});

// ── Logged Pill — Improvement #16 (animated entrance) ─────────────────────────

function LoggedPill({ log }: { log: HabitLog | undefined }) {
  const anim = useRef(new Animated.Value(0)).current;
  const prevLevel = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (log && log.level !== prevLevel.current) {
      anim.setValue(0);
      Animated.spring(anim, { toValue: 1, useNativeDriver: true, tension: 280, friction: 12 }).start();
    }
    prevLevel.current = log?.level;
  }, [log?.level]);

  if (!log) return null;
  const lvl = LEVELS.find(l => l.key === log.level)!;
  const isElite = log.level === 'elite';

  return (
    <Animated.View style={{ opacity: anim, transform: [{ scale: anim }] }}>
      <LinearGradient
        colors={isElite ? ['#FCC10C', '#E5A800'] : ['#F3F4F6', '#E5E7EB']}
        style={s.loggedPill}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      >
        <Text style={[s.loggedPillText, isElite && { color: Colors.black }]}>
          {lvl.emoji} {lvl.label}
        </Text>
      </LinearGradient>
    </Animated.View>
  );
}

// ── Level Button — Improvements #15, #17 ───────────────────────────────────────

function LevelButton({
  emoji, label, isActive, activeBg, activeFg, onPress, isLoading,
}: {
  emoji: string; label: string; isActive: boolean;
  activeBg: string; activeFg: string; onPress: () => void; isLoading: boolean;
}) {
  const { colors } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;

  function handlePress() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 8 }),
    ]).start();
    onPress();
  }

  return (
    <TouchableOpacity onPress={handlePress} disabled={isLoading} activeOpacity={1} style={s.levelBtnTouch}>
      <Animated.View
        style={[
          s.levelBtn,
          { borderColor: colors.gray200, backgroundColor: colors.offWhite },
          isActive && { backgroundColor: activeBg, borderColor: activeBg },
          // Improvement #12: elite glow
          isActive && activeBg === Colors.yellow && { shadowColor: '#FCC10C', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
          { transform: [{ scale }] },
        ]}
      >
        <Text style={s.levelEmoji}>{emoji}</Text>
        <Text style={[s.levelLabel, { color: colors.gray600 }, isActive && { color: activeFg }]}>{label}</Text>
        {/* Improvement #17: checkmark on active */}
        {isActive && (
          <View style={s.levelCheck}>
            <Ionicons name="checkmark-circle" size={14} color={activeFg} />
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── All Done Card — Improvement #26 ───────────────────────────────────────────

function AllDoneCard({ day }: { day: string }) {
  const scale = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 120, friction: 10 }).start();
  }, []);
  const label = dayLabel(day);
  return (
    <Animated.View style={[s.allDoneCard, { transform: [{ scale }] }]}>
      <LinearGradient colors={['#FCC10C', '#E5A800']} style={s.allDoneGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <Text style={s.allDoneEmoji}>🏆</Text>
        <Text style={s.allDoneTitle}>Perfect!</Text>
        <Text style={s.allDoneSub}>Alle habits voltooid{day === today ? ' vandaag' : ` op ${label.toLowerCase()}`}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

// ── Month Overview — Improvements #21–25 ───────────────────────────────────────

function MonthOverview({ habits, monthLogs, onDayPress }: {
  habits: Habit[]; monthLogs: HabitLog[]; onDayPress: (d: string) => void;
}) {
  const { colors } = useTheme();
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
  const monthName = now.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
  const todayNum = now.getDate();

  const cells: (number | null)[] = [
    ...Array(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function status(dayNum: number): 'none' | 'partial' | 'all' | 'elite' {
    if (habits.length === 0) return 'none';
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    const dayLogs = monthLogs.filter(l => l.date === dateStr);
    if (dayLogs.length === 0) return 'none';
    if (dayLogs.length >= habits.length) return dayLogs.some(l => l.level === 'elite') ? 'elite' : 'all';
    return 'partial';
  }

  function toDateStr(dayNum: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
  }

  // Improvements #23, #24, #25
  const perfectDays = computePerfectDays(habits, monthLogs);
  const overallStreak = computeOverallStreak(habits, monthLogs);
  const daysElapsed = Math.min(todayNum, daysInMonth);
  const loggedDays = Array.from({ length: daysElapsed }, (_, i) => i + 1).filter(d => status(d) !== 'none').length;
  const completionPct = daysElapsed > 0 ? Math.round((loggedDays / daysElapsed) * 100) : 0;

  return (
    <View style={[m.card, { backgroundColor: colors.white }]}>
      <View style={m.headerRow}>
        <View>
          <Text style={[m.title, { color: colors.black }]}>Maandoverzicht</Text>
          <Text style={[m.subtitle, { color: colors.gray400 }]}>{monthName}</Text>
        </View>
        {/* Improvement #25 */}
        <View style={m.pctBadge}>
          <Text style={m.pctText}>{completionPct}%</Text>
        </View>
      </View>

      {/* Improvement #23, #24: stats row */}
      <View style={m.statsRow}>
        <View style={m.statChip}>
          <Text style={m.statChipIcon}>🏅</Text>
          <Text style={[m.statChipLabel, { color: colors.gray600 }]}>{perfectDays} perfect</Text>
        </View>
        {overallStreak > 0 && (
          <View style={m.statChip}>
            <Text style={m.statChipIcon}>🔥</Text>
            <Text style={[m.statChipLabel, { color: colors.gray600 }]}>{overallStreak} streak</Text>
          </View>
        )}
      </View>

      <View style={m.weekRow}>
        {WEEK_DAYS_SHORT.map(d => (
          <Text key={d} style={[m.weekLabel, { color: colors.gray400 }]}>{d}</Text>
        ))}
      </View>

      <View style={m.grid}>
        {cells.map((day, idx) =>
          day === null ? <View key={`e${idx}`} style={m.cell} /> : (
            // Improvement #21: tap to navigate
            <TouchableOpacity
              key={day}
              style={[m.cell, day === todayNum && { backgroundColor: colors.gray100, borderRadius: 8 }]}
              onPress={() => {
                const ds = toDateStr(day);
                if (ds <= today) onDayPress(ds);
              }}
              activeOpacity={day > todayNum ? 1 : 0.7}
            >
              <Text style={[
                m.cellNum,
                { color: day > todayNum ? colors.gray200 : colors.gray600 },
                day === todayNum && { fontFamily: 'Inter_700Bold', color: colors.black },
              ]}>{day}</Text>
              {/* Improvement #22: bigger dots (8px) */}
              {status(day) !== 'none' && (
                <View style={[
                  m.dot,
                  status(day) === 'partial' && m.dotPartial,
                  status(day) === 'all'     && m.dotAll,
                  status(day) === 'elite'   && m.dotElite,
                ]} />
              )}
            </TouchableOpacity>
          )
        )}
      </View>

      <View style={m.legend}>
        <View style={m.legendItem}><View style={[m.dot, m.dotPartial]} /><Text style={[m.legendLabel, { color: colors.gray400 }]}>Deels</Text></View>
        <View style={m.legendItem}><View style={[m.dot, m.dotAll]}     /><Text style={[m.legendLabel, { color: colors.gray400 }]}>Alles</Text></View>
        <View style={m.legendItem}><View style={[m.dot, m.dotElite]}   /><Text style={[m.legendLabel, { color: colors.gray400 }]}>Elite</Text></View>
      </View>
    </View>
  );
}

// ── Lite mode ─────────────────────────────────────────────────────────────────

function HabitsLite() {
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { toastProps, show: showToast } = useToast();
  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); return; }
    const [{ data: h }, { data: l }] = await Promise.all([
      supabase.from('habits').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order'),
      supabase.from('habit_logs').select('*').eq('user_id', user.id).eq('date', today),
    ]);
    if (h) setHabits(h);
    if (l) setLogs(l);
    setLoading(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function logHabit(habit: Habit, level: 'mini' | 'good' | 'elite') {
    if (!user) return;
    haptic('medium');
    setLoadingId(`${habit.id}-${level}`);
    const existing = logs.find(l => l.habit_id === habit.id && l.date === today);
    if (existing) {
      await supabase.from('habit_logs').update({ level }).eq('id', existing.id);
    } else {
      await supabase.from('habit_logs').insert({ user_id: user.id, habit_id: habit.id, date: today, level });
    }
    await fetchData();
    setLoadingId(null);
    haptic('success');
    showToast(`${habit.name} gelogd!`, 'success');
  }

  const todayLabel = new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
      <View style={[s.banner, { paddingTop: insets.top + 36 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
        <Text style={s.bannerTitle}>Habits</Text>
        <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: '#888', marginTop: 4 }}>{todayLabel[0].toUpperCase() + todayLabel.slice(1)}</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 120 }}>
        {loading ? (
          <SkeletonHabitCard />
        ) : habits.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
            <Text style={{ fontSize: 40 }}>🏆</Text>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Geen habits</Text>
            <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, textAlign: 'center' }}>
              Stuur "voeg habit toe" via WhatsApp.
            </Text>
          </View>
        ) : habits.map(habit => {
          const log = logs.find(l => l.habit_id === habit.id);
          return (
            <View key={habit.id} style={[{ backgroundColor: colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10 }, Shadow.card]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.black, flex: 1 }}>{habit.name}</Text>
                {log && (
                  <View style={{ backgroundColor: Colors.yellow, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
                    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.black }}>
                      {LEVELS.find(l => l.key === log.level)?.label}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {LEVELS.map(lv => {
                  const active = log?.level === lv.key;
                  const isLoading = loadingId === `${habit.id}-${lv.key}`;
                  return (
                    <TouchableOpacity
                      key={lv.key}
                      onPress={() => logHabit(habit, lv.key)}
                      style={[{ flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center', backgroundColor: active ? Colors.yellow : colors.gray100 }]}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 16 }}>{lv.emoji}</Text>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: active ? Colors.black : colors.gray400, marginTop: 2 }}>{lv.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
      </ScrollView>
      <Toast {...toastProps} />
    </View>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function HabitsTab() {
  const { settings } = useModuleSettings();
  if (settings.habits_mode === 'lite') return <HabitsLite />;
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const stripRef = useRef<FlatList>(null);

  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [monthLogs, setMonthLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState(today);
  // Improvement #15: per-button loading key = `${habitId}-${selectedDay}-${level}`
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const { toastProps, show: showToast } = useToast();

  // Improvement #28: fade animation on day change
  const fadeAnim = useRef(new Animated.Value(1)).current;

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [{ data: habitData }, { data: logData }, { data: monthLogData }] = await Promise.all([
      supabase.from('habits').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order', { ascending: true }),
      // Improvement #6: fetch 90 days for streak computation
      supabase.from('habit_logs').select('*').eq('user_id', user.id).gte('date', NINETY_DAYS_AGO),
      supabase.from('habit_logs').select('*').eq('user_id', user.id).gte('date', MONTH_START),
    ]);
    if (habitData) setHabits(habitData);
    if (logData) setLogs(logData);
    if (monthLogData) setMonthLogs(monthLogData);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Scroll strip to end (today) on mount — Improvement #6
  useEffect(() => {
    setTimeout(() => stripRef.current?.scrollToEnd({ animated: false }), 100);
  }, [loading]);

  function selectDay(date: string) {
    if (date === selectedDay) return;
    // Improvement #28: fade out/in
    Animated.timing(fadeAnim, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setSelectedDay(date);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
    haptic('light');
  }

  function getLog(habitId: string, date: string) {
    return logs.find(l => l.habit_id === habitId && l.date === date);
  }

  async function logHabit(habit: Habit, level: 'mini' | 'good' | 'elite') {
    if (!user) return;
    const existing = getLog(habit.id, selectedDay);
    const key = `${habit.id}-${selectedDay}-${level}`;
    setLoadingKey(key);

    if (existing?.level === level) {
      haptic('light');
      await supabase.from('habit_logs').delete().eq('id', existing.id);
      showToast(`${habit.name} ongedaan gemaakt`, 'info');
    } else {
      haptic('success');
      await supabase.from('habit_logs').upsert(
        { habit_id: habit.id, user_id: user.id, date: selectedDay, level, logged_at: new Date().toISOString() },
        { onConflict: 'habit_id,date' },
      );
      const lvl = LEVELS.find(l => l.key === level)!;
      showToast(`${lvl.emoji} ${habit.name} — ${lvl.label}!`, 'success');
    }

    setLoadingKey(null);
    fetchData();
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const weekScore = useMemo(() => computeWeekScore(logs), [logs]);

  const habitData = useMemo(() => habits.map(habit => ({
    habit,
    log: getLog(habit.id, selectedDay),
    streak: computeStreak(habit.id, logs, selectedDay),
    weekHist: strip.map(day => logs.find(l => l.habit_id === habit.id && l.date === day.date)?.level ?? null),
  })), [habits, logs, selectedDay]);

  const todayLogsCount = useMemo(() => logs.filter(l => l.date === today).length, [logs]);
  const allDoneToday   = habits.length > 0 && todayLogsCount >= habits.length;
  const selectedLogsCount = useMemo(() => logs.filter(l => l.date === selectedDay).length, [logs, selectedDay]);
  const allDoneSelected   = habits.length > 0 && selectedLogsCount >= habits.length;

  const completionPct = habits.length > 0 ? (selectedLogsCount / habits.length) : 0;
  const isPastDay = selectedDay < today;
  const isFutureDay = selectedDay > today;

  // Improvement #1: motivational subtitle
  const bannerSubtitle = useMemo(() => {
    const overallStreak = computeOverallStreak(habits, logs);
    if (allDoneToday && overallStreak >= 3) return `🔥 ${overallStreak} dagen op rij!`;
    if (allDoneToday) return 'Alle habits voltooid!';
    if (overallStreak >= 7) return `🔥 ${overallStreak} days — fantastisch!`;
    if (overallStreak >= 3) return `🔥 ${overallStreak} dagen op rij`;
    if (todayLogsCount > 0) return `${todayLogsCount} van ${habits.length} vandaag`;
    return habits.length > 0 ? 'Begin je dag sterk' : '';
  }, [habits, logs, allDoneToday, todayLogsCount]);

  // Improvement #9: day completion per strip day
  function stripDayCompletion(date: string) {
    if (habits.length === 0) return null;
    const count = logs.filter(l => l.date === date).length;
    const all = habits.length;
    if (count === 0) return null;
    if (count >= all) return 'all';
    return 'partial';
  }

  if (loading) {
    return (
      <View style={[s.root, { backgroundColor: colors.offWhite }]}>
        <View style={[s.banner, { paddingTop: insets.top + 40, paddingBottom: 28 }]}>
          <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
          <Text style={s.bannerTitle}>Habits</Text>
        </View>
        <View style={s.skeletonList}>
          {[0, 1, 2].map(i => <SkeletonHabitCard key={i} />)}
        </View>
      </View>
    );
  }

  return (
    <View style={[s.root, { backgroundColor: colors.offWhite }]}>
      <ScrollView
        style={[s.container, { backgroundColor: colors.offWhite }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={Colors.yellow} />}
      >
        {/* ── Banner ── */}
        <View style={[s.banner, { paddingTop: insets.top + 40 }]}>
          <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />

          <View style={s.bannerTop}>
            <View style={{ flex: 1 }}>
              {/* Improvement #4: trophy emoji when all done */}
              <Text style={s.bannerTitle}>{allDoneToday ? '🏆 Habits' : 'Habits'}</Text>
              {/* Improvement #1: motivational subtitle */}
              {bannerSubtitle ? <Text style={s.bannerSubtitle}>{bannerSubtitle}</Text> : null}
            </View>
            {/* Improvement #3: weekly score pill */}
            {weekScore > 0 && (
              <View style={s.scorePill}>
                <Text style={s.scorePillText}>⭐ {weekScore} pts</Text>
              </View>
            )}
          </View>

          {/* Improvement #2: progress bar */}
          {habits.length > 0 && (
            <View style={s.progressBarWrap}>
              <View style={[s.progressBarTrack, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                <View style={[s.progressBarFill, { width: `${Math.round(completionPct * 100)}%` as any }]} />
              </View>
              <Text style={s.progressPct}>{Math.round(completionPct * 100)}%</Text>
            </View>
          )}

          {/* Improvement #6/#9/#7: 14-day scrollable strip with future dimming and completion dots */}
          <FlatList
            ref={stripRef}
            data={strip}
            keyExtractor={d => d.date}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 16 }}
            contentContainerStyle={{ gap: 4 }}
            renderItem={({ item: day }) => {
              const isSelected = day.date === selectedDay;
              const isToday = day.date === today;
              const isFuture = day.date > today;
              const completion = stripDayCompletion(day.date);
              return (
                <TouchableOpacity
                  style={[
                    s.dayPill,
                    isSelected && s.dayPillSelected,
                    isFuture && { opacity: 0.4 }, // Improvement #7
                  ]}
                  onPress={() => { if (!isFuture) selectDay(day.date); }}
                  activeOpacity={isFuture ? 1 : 0.75}
                  hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                >
                  {/* Improvement #8: "Vand." label for today */}
                  <Text style={[s.dayLabel, isSelected && s.dayLabelActive]}>
                    {isToday && !isSelected ? 'Vand.' : day.day}
                  </Text>
                  <View style={[s.dayNumBox, isToday && !isSelected && s.dayNumToday]}>
                    <Text style={[s.dayNum, isSelected && s.dayNumActive, isToday && !isSelected && { color: Colors.yellow }]}>
                      {day.num}
                    </Text>
                  </View>
                  {/* Improvement #10: colored dot instead of text */}
                  {completion === 'all'     && <View style={[s.completionDot, isSelected ? s.completionDotSelected : s.completionDotAll]} />}
                  {completion === 'partial' && <View style={[s.completionDot, isSelected ? s.completionDotSelected : s.completionDotPartial]} />}
                  {!completion              && <View style={s.completionPlaceholder} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {/* Improvement #5: past day notice */}
        {isPastDay && (
          <View style={[s.pastNotice, { backgroundColor: colors.gray100 }]}>
            <Ionicons name="time-outline" size={13} color={colors.gray400} />
            <Text style={[s.pastNoticeText, { color: colors.gray400 }]}>
              Je bekijkt {dayLabel(selectedDay).toLowerCase()}
            </Text>
          </View>
        )}

        {habits.length === 0 ? (
          // Improvement #30: better empty state
          <View style={s.emptyContainer}>
            <View style={[s.emptyIcon, { backgroundColor: colors.gray100 }]}>
              <Text style={{ fontSize: 36 }}>🏋️</Text>
            </View>
            <Text style={[s.emptyTitle, { color: colors.black }]}>Begin met habits</Text>
            <Text style={[s.emptyText, { color: colors.gray400 }]}>
              Stuur een WhatsApp-bericht om je eerste habit aan te maken:
            </Text>
            <View style={[s.emptyStep, { backgroundColor: colors.white }]}>
              <Text style={s.emptyStepNum}>1</Text>
              <Text style={[s.emptyStepText, { color: colors.black }]}>
                "voeg habit toe: mediteren"
              </Text>
            </View>
            <View style={[s.emptyStep, { backgroundColor: colors.white }]}>
              <Text style={s.emptyStepNum}>2</Text>
              <Text style={[s.emptyStepText, { color: colors.black }]}>
                "mini=5min, goed=15min, elite=30min"
              </Text>
            </View>
            <View style={[s.emptyStep, { backgroundColor: colors.white }]}>
              <Text style={s.emptyStepNum}>3</Text>
              <Text style={[s.emptyStepText, { color: colors.black }]}>
                Log dagelijks en bouw je streak op 🔥
              </Text>
            </View>
          </View>
        ) : (
          <Animated.View style={[s.habitsList, { opacity: fadeAnim }]}>

            {/* Improvement #18: section label */}
            <Text style={[s.sectionLabel, { color: colors.gray400 }]}>
              {dayLabel(selectedDay).toUpperCase()} · {habits.length} HABITS
            </Text>

            {/* Improvement #26: all done celebration card */}
            {allDoneSelected && <AllDoneCard day={selectedDay} />}

            {habitData.map(({ habit, log, streak, weekHist }) => {
              const isElite = log?.level === 'elite';
              const accentColor = log?.level === 'elite' ? Colors.yellow
                : log?.level === 'good'  ? '#6B7280'
                : log?.level === 'mini'  ? '#92400E'
                : colors.gray200;

              return (
                <View
                  key={habit.id}
                  style={[
                    s.habitCard,
                    { backgroundColor: colors.white },
                    // Improvement #12: elite golden glow
                    isElite && { shadowColor: '#FCC10C', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
                  ]}
                >
                  {/* Improvement #11: left accent bar */}
                  <View style={[s.accentBar, { backgroundColor: accentColor }]} />

                  <View style={s.habitInner}>
                    {/* Card header */}
                    <View style={s.habitHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={[s.habitName, { color: colors.black }]}>{habit.name}</Text>
                        {/* Improvement #13: streak badge */}
                        {streak > 0 && (
                          <Text style={[s.streakBadge, { color: colors.gray400 }]}>
                            🔥 {streak} {streak === 1 ? 'dag' : 'dagen'} op rij
                          </Text>
                        )}
                        {/* Improvement #14: 7-day sparkline */}
                        <SparkLine habitId={habit.id} logs={logs} />
                      </View>
                      {/* Improvement #16: animated logged pill */}
                      <LoggedPill log={log} />
                    </View>

                    {/* Improvement #19: separator */}
                    <View style={[s.cardDivider, { backgroundColor: colors.gray100 }]} />

                    {/* Level buttons */}
                    <View style={s.levelRow}>
                      {LEVELS.map(lvl => {
                        const btnKey = `${habit.id}-${selectedDay}-${lvl.key}`;
                        return (
                          <LevelButton
                            key={lvl.key}
                            emoji={lvl.emoji}
                            label={lvl.label}
                            isActive={log?.level === lvl.key}
                            activeBg={lvl.activeBg}
                            activeFg={lvl.activeFg}
                            onPress={() => logHabit(habit, lvl.key)}
                            isLoading={loadingKey === btnKey}
                          />
                        );
                      })}
                    </View>

                    {/* Improvement #20: goals with cleaner design */}
                    <View style={s.goalsRow}>
                      <GoalChip emoji="🥉" text={habit.mini_goal} colors={colors} />
                      <GoalChip emoji="🥈" text={habit.good_goal} colors={colors} />
                      <GoalChip emoji="🥇" text={habit.elite_goal} colors={colors} />
                    </View>
                  </View>
                </View>
              );
            })}

            <MonthOverview
              habits={habits}
              monthLogs={monthLogs}
              onDayPress={(d) => {
                selectDay(d);
                // scroll strip to show the tapped date
                const idx = strip.findIndex(s => s.date === d);
                if (idx >= 0) stripRef.current?.scrollToIndex({ index: idx, animated: true });
              }}
            />
          </Animated.View>
        )}
      </ScrollView>

      <Toast {...toastProps} />
    </View>
  );
}

// ── Goal Chip — Improvement #20 ────────────────────────────────────────────────

function GoalChip({ emoji, text, colors }: { emoji: string; text: string; colors: any }) {
  return (
    <View style={[s.goalChip, { backgroundColor: colors.gray100 }]}>
      <Text style={s.goalChipEmoji}>{emoji}</Text>
      <Text style={[s.goalChipText, { color: colors.gray600 }]} numberOfLines={1}>{text}</Text>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1 },

  // Banner
  banner: { paddingHorizontal: 20, paddingBottom: 20, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  bannerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  bannerTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, color: Colors.white, letterSpacing: -0.5 },
  bannerSubtitle: { fontFamily: 'Inter_300Light', fontSize: 13, color: Colors.yellow, marginTop: 3 },

  // Improvement #3: score pill
  scorePill: { backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: Radius.pill, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', marginTop: 4 },
  scorePillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.yellow },

  // Improvement #2: progress bar
  progressBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  progressBarTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: Colors.yellow, borderRadius: 2 },
  progressPct: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 30, textAlign: 'right' },

  // Improvement #6/#9: day strip — taller pills
  dayPill: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: Radius.md, width: 46 },
  dayPillSelected: { backgroundColor: Colors.yellow },
  dayLabel: { fontFamily: 'Inter_300Light', fontSize: 8, color: 'rgba(255,255,255,0.5)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.3 },
  dayLabelActive: { color: Colors.black },
  dayNumBox: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  dayNumToday: { borderWidth: 1.5, borderColor: Colors.yellow },
  dayNum: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  dayNumActive: { color: Colors.black },
  // Improvement #10: completion dot
  completionDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
  completionDotAll:      { backgroundColor: Colors.yellow },
  completionDotPartial:  { backgroundColor: 'rgba(255,255,255,0.4)' },
  completionDotSelected: { backgroundColor: Colors.black },
  completionPlaceholder: { height: 10, marginTop: 4 },

  // Improvement #5: past day notice
  pastNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginTop: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pastNoticeText: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  // Improvement #18: section label
  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.8, marginBottom: 8 },

  // Habits list
  habitsList: { padding: 16, gap: 14, paddingBottom: 120 },
  habitCard: { borderRadius: Radius.xl, overflow: 'hidden', flexDirection: 'row', ...Shadow.card },
  habitInner: { flex: 1, padding: 16 },

  // Improvement #11: accent bar
  accentBar: { width: 4 },

  // Habit header
  habitHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  habitName: { fontFamily: 'Inter_700Bold', fontSize: 17, marginRight: 10, marginBottom: 2 },

  // Improvement #13: streak
  streakBadge: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },

  // Improvement #19: divider
  cardDivider: { height: 1, marginBottom: 12 },

  // Level buttons
  levelRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  levelBtnTouch: { flex: 1 },
  levelBtn: {
    alignItems: 'center', paddingVertical: 14, borderRadius: Radius.md,
    borderWidth: 1.5, minHeight: 68, justifyContent: 'center', position: 'relative',
  },
  levelEmoji: { fontSize: 22, marginBottom: 4 },
  levelLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  // Improvement #17: checkmark badge
  levelCheck: { position: 'absolute', top: 5, right: 5 },

  // Logged pill
  loggedPill: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  loggedPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.gray600 },

  // Improvement #20: goal chips
  goalsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  goalChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  goalChipEmoji: { fontSize: 11 },
  goalChipText: { fontFamily: 'Inter_300Light', fontSize: 11 },

  // Improvement #26: all done card
  allDoneCard: { borderRadius: Radius.xl, overflow: 'hidden', marginBottom: 4 },
  allDoneGradient: { padding: 20, alignItems: 'center' },
  allDoneEmoji: { fontSize: 40, marginBottom: 8 },
  allDoneTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.black, letterSpacing: -0.5 },
  allDoneSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(0,0,0,0.6)', marginTop: 4 },

  // Improvement #30: empty state
  emptyContainer: { padding: 32, alignItems: 'center', marginTop: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 8 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  emptyStep: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.md, padding: 12, width: '100%', marginBottom: 8, ...Shadow.card },
  emptyStepNum: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.yellow, width: 24, textAlign: 'center' },
  emptyStepText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },

  skeletonList: { padding: 16 },
});

// Month overview styles
const m = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: 16, ...Shadow.card, marginTop: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  subtitle: { fontFamily: 'Inter_300Light', fontSize: 12, textTransform: 'capitalize', marginTop: 2 },
  // Improvement #25: completion pct badge
  pctBadge: { backgroundColor: Colors.yellow, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pctText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: Colors.black },
  // Improvements #23, #24: stats row
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.gray100, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statChipIcon: { fontSize: 12 },
  statChipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%` as any, alignItems: 'center', paddingVertical: 5 },
  cellNum: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  // Improvement #22: bigger dots (8px)
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 3 },
  dotPartial: { backgroundColor: '#FDE68A' },
  dotAll:     { backgroundColor: Colors.yellow },
  dotElite:   { backgroundColor: '#E5A800' },
  legend: { flexDirection: 'row', gap: 12, marginTop: 12, justifyContent: 'flex-end' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLabel: { fontFamily: 'Inter_300Light', fontSize: 11 },
});
