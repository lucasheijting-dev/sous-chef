import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Animated,
  Pressable,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { Habit, HabitLog } from '@/lib/types';
import { Colors, Radius, Shadow, TAB_BAR_CLEARANCE } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { SkeletonHabitCard } from '@/components/SkeletonCard';
import { Toast, useToast } from '@/components/Toast';
import Confetti from '@/components/Confetti';
import { getCache, setCache } from '@/lib/cache';
import { SwipeDeleteRow } from '@/components/SwipeDeleteRow';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

// ── Constants ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h >= 5  && h < 12) return 'Goedemorgen';
  if (h >= 12 && h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

function haptic(style: 'light' | 'medium' | 'success' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'success') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

const LEVELS = [
  { key: 'mini',  emoji: '⚡', label: 'Mini',  medalBg: '#22C55E', borderActive: '#22C55E', pts: 1 },
  { key: 'good',  emoji: '⭐', label: 'Plus',  medalBg: '#A9AFB7', borderActive: '#A9AFB7', pts: 2 },
  { key: 'elite', emoji: '🏆', label: 'Elite', medalBg: Colors.yellow, borderActive: Colors.yellow, pts: 3 },
] as const;

// ── Pure UTC date helpers (no local-timezone ambiguity) ──────────────────────

function utcDateStr(ms: number): string {
  return new Date(ms).toISOString().split('T')[0];
}

function utcMsFromStr(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// today is UTC calendar date — resets at UTC midnight (= 2am Amsterdam summer).
// This prevents the common "just past midnight local, but still same habit day" issue.
const today = new Date().toISOString().split('T')[0];

const MONTH_START = (() => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
})();

const NINETY_DAYS_AGO = utcDateStr(Date.now() - 90 * 86400000);

const STRIP_DAYS = Math.max(7, new Date().getUTCDate());

function getDayStrip(count: number) {
  const todayMs = utcMsFromStr(today);
  return Array.from({ length: count }, (_, i) => {
    const ms = todayMs - (count - 1 - i) * 86400000;
    const d = new Date(ms);
    return {
      date: utcDateStr(ms),
      day: d.toLocaleDateString('nl-NL', { weekday: 'short', timeZone: 'UTC' }).slice(0, 2).toUpperCase(),
      num: String(d.getUTCDate()),
    };
  });
}

const strip = getDayStrip(STRIP_DAYS);
const WEEK_DAYS_SHORT = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function dayLabel(dateKey: string): string {
  const diff = Math.round((utcMsFromStr(today) - utcMsFromStr(dateKey)) / 86400000);
  if (diff === 0) return 'Vandaag';
  if (diff === 1) return 'Gisteren';
  return new Date(utcMsFromStr(dateKey)).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

function computeStreak(habitId: string, logs: HabitLog[], endDate: string): number {
  let ms = utcMsFromStr(endDate);
  let streak = 0;
  for (let i = 0; i < 90; i++) {
    const ds = utcDateStr(ms);
    if (!logs.some(l => l.habit_id === habitId && l.date === ds)) break;
    streak++;
    ms -= 86400000;
  }
  return streak;
}

function computeWeekScore(logs: HabitLog[]): number {
  const weekStart = utcDateStr(utcMsFromStr(today) - 6 * 86400000);
  return logs
    .filter(l => l.date >= weekStart && l.date <= today)
    .reduce((s, l) => s + (LEVELS.find(lv => lv.key === l.level)?.pts ?? 0), 0);
}

function AnimatedCounter({ value, style }: { value: number; style?: any }) {
  const animVal = useRef(new Animated.Value(value)).current;
  const [display, setDisplay] = useState(value);
  const prevValue = useRef(value);

  useEffect(() => {
    if (value === prevValue.current) return;
    prevValue.current = value;
    animVal.setValue(0);
    Animated.timing(animVal, { toValue: value, duration: 600, useNativeDriver: false }).start();
    const id = animVal.addListener(({ value: v }) => setDisplay(Math.round(v)));
    return () => animVal.removeListener(id);
  }, [value]);

  return <Text style={style}>{display}</Text>;
}

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

function computeOverallStreak(habits: Habit[], logs: HabitLog[]): number {
  if (habits.length === 0) return 0;
  let streak = 0;
  let ms = utcMsFromStr(today);
  for (let i = 0; i < 90; i++) {
    const ds = utcDateStr(ms);
    const dayLogs = logs.filter(l => l.date === ds);
    const allDone = habits.every(h => dayLogs.some(l => l.habit_id === h.id));
    if (!allDone) break;
    streak++;
    ms -= 86400000;
  }
  return streak;
}

// ── Completion Ring ────────────────────────────────────────────────────────────

function CompletionRing({ level }: { level: string | undefined }) {
  const { colors } = useTheme();
  const dots = [
    level === 'mini' || level === 'good' || level === 'elite',
    level === 'good' || level === 'elite',
    level === 'elite',
  ];
  return (
    <View style={ring.wrap}>
      {dots.map((filled, i) => (
        <View
          key={i}
          style={[ring.dot, filled ? ring.dotFilled : [ring.dotEmpty, { borderColor: colors.gray200 }]]}
        />
      ))}
    </View>
  );
}

const ring = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 3, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotFilled: { backgroundColor: Colors.yellow },
  dotEmpty: { backgroundColor: 'transparent', borderWidth: 1.5 },
});

// ── Spark Line ─────────────────────────────────────────────────────────────────

function SparkLine({ habitId, logs }: { habitId: string; logs: HabitLog[] }) {
  const { colors } = useTheme();
  const last7 = strip.slice(-7);
  return (
    <View style={spark.wrap}>
      {last7.map(day => {
        const log = logs.find(l => l.habit_id === habitId && l.date === day.date);
        const isFuture = day.date > today;
        const isToday = day.date === today;
        const filled = !isFuture && !!log;
        const bg = isFuture ? 'transparent'
          : log?.level === 'elite' ? Colors.yellow
          : log?.level === 'good'  ? '#6B7280'
          : log?.level === 'mini'  ? '#B45309'
          : colors.gray200;
        return (
          <View key={day.date} style={spark.col}>
            <Text style={[spark.label, { color: isToday ? Colors.yellow : colors.gray400 }]}>{day.day[0]}</Text>
            <View style={[
              spark.dot,
              { backgroundColor: bg, borderColor: isFuture ? colors.gray200 : bg },
              isToday && !filled && { borderColor: Colors.yellow, borderWidth: 1.5 },
            ]} />
          </View>
        );
      })}
    </View>
  );
}

const spark = StyleSheet.create({
  wrap: { flexDirection: 'row', gap: 5, marginTop: 10 },
  col:  { alignItems: 'center', gap: 3 },
  label: { fontFamily: 'Inter_400Regular', fontSize: 9, lineHeight: 11 },
  dot:  { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
});

// ── Logged Pill ────────────────────────────────────────────────────────────────

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

  const timeStr = log.logged_at
    ? new Date(log.logged_at).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <Animated.View style={{ opacity: anim, transform: [{ scale: anim }], alignItems: 'flex-end', gap: 2 }}>
      <LinearGradient
        colors={isElite ? ['#FCC10C', '#E5A800'] : ['#F3F4F6', '#E5E7EB']}
        style={s.loggedPill}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      >
        <Text style={[s.loggedPillText, isElite && { color: Colors.black }]}>
          {lvl.emoji} {lvl.label}
        </Text>
      </LinearGradient>
      {timeStr && <Text style={{ fontFamily: 'Inter_300Light', fontSize: 10, color: Colors.gray400 }}>{timeStr}</Text>}
    </Animated.View>
  );
}

// ── All Done Card ──────────────────────────────────────────────────────────────

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

// ── Month Overview ─────────────────────────────────────────────────────────────

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
        <View style={m.pctBadge}>
          <Text style={m.pctText}>{completionPct}%</Text>
        </View>
      </View>

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

// ── Empty State with breathing animation ───────────────────────────────────────

function BreathingEmoji({ emoji, size = 40 }: { emoji: string; size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0,  duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.Text style={{ fontSize: size, transform: [{ scale: pulse }] }}>{emoji}</Animated.Text>
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
    if (h && l) setCache('cache_habits_lite', { habits: h, logs: l });
    setLoading(false);
  }, [user]);

  useEffect(() => {
    getCache<{ habits: Habit[]; logs: HabitLog[] }>('cache_habits_lite').then(d => {
      if (d) { setHabits(d.habits); setLogs(d.logs); setLoading(false); }
    });
  }, []);

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
      <View style={{ paddingTop: insets.top + 14, paddingHorizontal: 22, paddingBottom: 10 }}>
        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14.5, color: colors.gray400, marginBottom: 3 }}>{todayLabel[0].toUpperCase() + todayLabel.slice(1)}</Text>
        <Text style={{ fontFamily: 'TitanOne_400Regular', fontSize: 27, color: colors.black, textTransform: 'uppercase', letterSpacing: 0.4 }}>Habits</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: TAB_BAR_CLEARANCE }}>
        {loading ? (
          <SkeletonHabitCard />
        ) : habits.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
            <BreathingEmoji emoji="🏆" />
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Geen habits</Text>
            <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, textAlign: 'center' }}>
              Stuur "voeg habit toe" via WhatsApp.
            </Text>
          </View>
        ) : habits.map(habit => {
          const log = logs.find(l => l.habit_id === habit.id);
          return (
            <View key={habit.id} style={[{ backgroundColor: colors.white, borderRadius: Radius.lg, padding: 18, marginBottom: 12 }, Shadow.card]}>
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

// ── Habit Card ─────────────────────────────────────────────────────────────────

function HabitCard({
  habit, log, streak, selectedDay, loadingKey, onCycle,
}: {
  habit: Habit; log: HabitLog | undefined; streak: number;
  selectedDay: string; loadingKey: string | null;
  onCycle: (habit: Habit, log: HabitLog | undefined) => void;
}) {
  const { colors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const prevLevel = useRef<string | undefined>(undefined);
  const level = log?.level;
  const isLoading = loadingKey === `${habit.id}-${selectedDay}-cycle`;

  useEffect(() => {
    if (level && level !== prevLevel.current) {
      Animated.sequence([
        Animated.timing(flashOpacity, { toValue: 0.6, duration: 80, useNativeDriver: true }),
        Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
    prevLevel.current = level;
  }, [level]);

  const medalBg: Record<string, string> = {
    mini: '#22C55E', good: isDark ? '#B6BCC4' : '#A9AFB7', elite: Colors.yellow, not_done: '#EF4444',
  };
  const medalFg: Record<string, string> = { mini: '#fff', good: '#fff', elite: Colors.black, not_done: '#fff' };
  const isFilled = !!level;

  const goalText = level === 'elite' ? habit.elite_goal : level === 'good' ? habit.good_goal : level === 'mini' ? habit.mini_goal : null;
  const levelLabel = LEVELS.find(l => l.key === level)?.label;
  const subText = level
    ? `${levelLabel} gelogd${goalText ? ` · ${goalText}` : ''}`
    : streak > 0 ? `${streak} ${streak === 1 ? 'dag' : 'dagen'} op rij`
    : 'Nog niet gelogd';

  function handlePress() {
    Animated.sequence([
      Animated.spring(scale, { toValue: 0.92, useNativeDriver: true, speed: 80 }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 220, friction: 8 }),
    ]).start();
    onCycle(habit, log);
  }

  return (
    <TouchableOpacity onPress={handlePress} disabled={isLoading} activeOpacity={0.88}
      style={[s.habitCard, { backgroundColor: colors.surface }]}>
      <Animated.View pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg, backgroundColor: Colors.yellow, opacity: flashOpacity }]} />
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[s.habitName, { color: colors.black }]}>{habit.name}</Text>
        <Text style={[s.habitSub, { color: colors.gray400 }]}>{subText}</Text>
      </View>
      <Animated.View style={[s.medal, {
        backgroundColor: isFilled ? medalBg[level!] : 'transparent',
        borderColor: isFilled ? medalBg[level!] : colors.hairline,
        borderStyle: isFilled ? 'solid' : 'dashed',
      }, { transform: [{ scale }] }]}>
        {isLoading
          ? <ActivityIndicator size="small" color={isFilled ? medalFg[level!] : colors.gray400} />
          : <Ionicons name={isFilled ? 'medal' : 'add'} size={22} color={isFilled ? medalFg[level!] : colors.gray400} />}
      </Animated.View>
    </TouchableOpacity>
  );
}

// ── Habit Bar Card (day view) ──────────────────────────────────────────────────

const LEVEL_COLOR: Record<string, string> = {
  mini: '#22C55E', good: '#A9AFB7', elite: Colors.yellow, not_done: '#EF4444',
};

function HabitBarCard({ habit, log, isToday }: { habit: Habit; log: HabitLog | undefined; isToday: boolean }) {
  const { colors } = useTheme();
  const level = log?.level;
  const dotColor = level ? LEVEL_COLOR[level] : (isToday ? '#FEE2E2' : colors.gray100);
  return (
    <View style={[hbar.card, { backgroundColor: colors.surface }]}>
      <Text style={[hbar.name, { color: colors.black }]} numberOfLines={1}>{habit.name}</Text>
      <View style={[hbar.dot, { backgroundColor: dotColor }]} />
    </View>
  );
}

const hbar = StyleSheet.create({
  card: { borderRadius: Radius.lg, ...Shadow.card, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14 },
  name: { fontFamily: 'Inter_600SemiBold', fontSize: 15, flex: 1, marginRight: 12 },
  dot: { width: 26, height: 26, borderRadius: 13 },
});

// ── Week Grid ──────────────────────────────────────────────────────────────────

function WeekGrid({
  habits, logs, loadingKey, selectedDay,
  onCycle, onDetail,
}: {
  habits: Habit[];
  logs: HabitLog[];
  loadingKey: string | null;
  selectedDay: string;
  onCycle: (habit: Habit, log: HabitLog | undefined, date: string) => void;
  onDetail: (habit: Habit) => void;
}) {
  const { colors } = useTheme();

  const weekDays = useMemo(() => {
    const ms = utcMsFromStr(selectedDay);
    const dow = (new Date(ms).getUTCDay() + 6) % 7;
    const mondayMs = ms - dow * 86400000;
    return Array.from({ length: 7 }, (_, i) => {
      const dayMs = mondayMs + i * 86400000;
      const dateStr = utcDateStr(dayMs);
      return {
        date: dateStr,
        dow: ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'][i],
        num: new Date(dayMs).getUTCDate(),
        isToday: dateStr === today,
        isFuture: dateStr > today,
      };
    });
  }, [selectedDay]);

  const levelColor: Record<string, string> = { mini: '#22C55E', good: '#A9AFB7', elite: Colors.yellow, not_done: '#EF4444' };

  return (
    <View style={{ paddingHorizontal: 18, paddingBottom: 4 }}>
      {/* Day headers */}
      <View style={{ flexDirection: 'row', marginBottom: 10 }}>
        <View style={{ width: 90 }} />
        {weekDays.map(d => (
          <View key={d.date} style={{ flex: 1, alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color: d.isToday ? Colors.yellow : colors.gray400, textTransform: 'uppercase' }}>{d.dow}</Text>
            <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: d.isToday ? Colors.yellow : 'transparent', justifyContent: 'center', alignItems: 'center', marginTop: 2 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 10, color: d.isToday ? Colors.black : d.isFuture ? colors.gray200 : colors.black }}>{d.num}</Text>
            </View>
          </View>
        ))}
      </View>

      {/* Habit rows — dots only */}
      {habits.map(habit => (
        <View key={habit.id} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
          <TouchableOpacity onLongPress={() => { haptic('medium'); onDetail(habit); }} activeOpacity={0.7} style={{ width: 90 }}>
            <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: colors.black, paddingRight: 6 }}>{habit.name}</Text>
          </TouchableOpacity>
          {weekDays.map(d => {
            const log = logs.find(l => l.habit_id === habit.id && l.date === d.date);
            const isLoading = loadingKey === `${habit.id}-${d.date}-cycle`;
            return (
              <TouchableOpacity
                key={d.date}
                style={{ flex: 1, alignItems: 'center' }}
                onPress={() => !d.isFuture && onCycle(habit, log, d.date)}
                disabled={d.isFuture || isLoading}
                activeOpacity={0.7}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color={Colors.yellow} style={{ width: 22, height: 22 }} />
                ) : (
                  <View style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: log ? levelColor[log.level] : d.isFuture ? 'transparent' : colors.gray100,
                    borderWidth: !log && !d.isFuture ? 1 : 0,
                    borderColor: colors.gray200,
                  }} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function HabitsTab() {
  const { settings } = useModuleSettings();
  if (settings.habits_mode === 'lite') return <HabitsLite />;
  return <HabitsMain />;
}

function HabitsMain() {
  const { user } = useUser();
  const { colors } = useTheme();
  const { settings } = useModuleSettings();
  const insets = useSafeAreaInsets();
  const stripRef = useRef<FlatList>(null);

  const [habits, setHabits] = useState<Habit[]>([]);
  const [logs, setLogs] = useState<HabitLog[]>([]);
  const [monthLogs, setMonthLogs] = useState<HabitLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState(today);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const { toastProps, show: showToast } = useToast();

  const [confettiActive, setConfettiActive] = useState(false);
  const wasAllDone = useRef(false);
  const [milestoneStreak, setMilestoneStreak] = useState<{ habitName: string; streak: number } | null>(null);
  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [quickAddName, setQuickAddName] = useState('');
  const [quickAddMini, setQuickAddMini] = useState('');
  const [quickAddGood, setQuickAddGood] = useState('');
  const [quickAddElite, setQuickAddElite] = useState('');
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [viewMode, setViewMode] = useState<'day' | 'week'>('day');
  const [detailHabit, setDetailHabit] = useState<Habit | null>(null);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  const fetchData = useCallback(async () => {
    if (!user) return;
    const [{ data: habitData }, { data: logData }, { data: monthLogData }] = await Promise.all([
      supabase.from('habits').select('*').eq('user_id', user.id).eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('habit_logs').select('*').eq('user_id', user.id).gte('date', NINETY_DAYS_AGO),
      supabase.from('habit_logs').select('*').eq('user_id', user.id).gte('date', MONTH_START),
    ]);
    if (habitData) setHabits(habitData);
    if (logData) setLogs(logData);
    if (monthLogData) setMonthLogs(monthLogData);
    if (habitData && logData && monthLogData)
      setCache('cache_habits_full', { habits: habitData, logs: logData, monthLogs: monthLogData });
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    getCache<{ habits: Habit[]; logs: HabitLog[]; monthLogs: HabitLog[] }>('cache_habits_full').then(d => {
      if (d) { setHabits(d.habits); setLogs(d.logs); setMonthLogs(d.monthLogs); setLoading(false); }
    });
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Re-snap selectedDay to UTC today whenever the habits tab is focused (handles overnight app sessions)
  useFocusEffect(useCallback(() => {
    const realToday = new Date().toISOString().split('T')[0];
    setSelectedDay(prev => (prev > realToday ? realToday : prev));
    fetchData();
  }, [fetchData]));

  useEffect(() => {
    setTimeout(() => stripRef.current?.scrollToEnd({ animated: false }), 100);
  }, [loading]);

  function selectDay(date: string) {
    if (date === selectedDay) return;
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
      await fetch(`${API_BASE}/habits/logs/${existing.id}?user_id=${user.id}`, { method: 'DELETE' }).catch(() => {});
      showToast(`${habit.name} verwijderd`, 'info');
    } else {
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await supabase.from('habit_logs').upsert(
        { habit_id: habit.id, user_id: user.id, date: selectedDay, level, logged_at: new Date().toISOString() },
        { onConflict: 'habit_id,date' },
      );
      const lvl = LEVELS.find(l => l.key === level)!;
      showToast(`${lvl.emoji} ${habit.name} — ${lvl.label}!`, 'success');

      // Check streak milestone
      const newStreak = computeStreak(habit.id, logs, selectedDay) + 1;
      if ([7, 14, 21, 30, 60, 90].includes(newStreak)) {
        setTimeout(() => setMilestoneStreak({ habitName: habit.name, streak: newStreak }), 600);
      }
    }

    setLoadingKey(null);
    await fetchData();

    // Confetti when all habits done for today
    if (selectedDay === today) {
      const newLogsCount = logs.filter(l => l.date === today && l.habit_id !== habit.id).length + 1;
      if (!wasAllDone.current && newLogsCount >= habits.length && habits.length > 0) {
        wasAllDone.current = true;
        setConfettiActive(true);
        setTimeout(() => setConfettiActive(false), 3000);
      }
    }
  }

  async function cycleHabit(habit: Habit, currentLog: HabitLog | undefined, dateOverride?: string) {
    if (!user) return;
    const date = dateOverride ?? selectedDay;
    const CYCLE: Array<'mini' | 'good' | 'elite' | 'not_done'> = ['mini', 'good', 'elite', 'not_done'];
    const key = `${habit.id}-${date}-cycle`;
    setLoadingKey(key);
    if (!currentLog) {
      haptic('medium');
      await supabase.from('habit_logs').upsert(
        { habit_id: habit.id, user_id: user.id, date, level: 'mini', logged_at: new Date().toISOString() },
        { onConflict: 'habit_id,date' }
      );
      showToast(`${LEVELS[0].emoji} ${habit.name} — ${LEVELS[0].label}!`, 'success');
    } else {
      const idx = CYCLE.indexOf(currentLog.level as any);
      if (idx === CYCLE.length - 1 || currentLog.level === 'not_done') {
        haptic('light');
        await fetch(`${API_BASE}/habits/logs/${currentLog.id}?user_id=${user.id}`, { method: 'DELETE' }).catch(() => {});
        showToast(`${habit.name} verwijderd`, 'info');
      } else {
        const next = CYCLE[idx + 1];
        haptic(next === 'not_done' ? 'light' : 'success');
        await supabase.from('habit_logs').update({ level: next, logged_at: new Date().toISOString() }).eq('id', currentLog.id);
        if (next === 'not_done') {
          showToast(`${habit.name} — Niet gedaan`, 'info');
        } else {
          const lvl = LEVELS.find(l => l.key === next)!;
          showToast(`${lvl.emoji} ${habit.name} — ${lvl.label}!`, 'success');
        }
      }
    }
    setLoadingKey(null);
    await fetchData();
  }

  async function deleteHabit(habitId: string) {
    setHabits(prev => prev.filter(h => h.id !== habitId));
    fetch(`${API_BASE}/habits/${habitId}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function saveQuickAddHabit() {
    if (!user || !quickAddName.trim()) return;
    setQuickAddSaving(true);
    await supabase.from('habits').insert({
      user_id: user.id,
      name: quickAddName.trim(),
      mini_goal: quickAddMini.trim() || 'Minimum',
      good_goal: quickAddGood.trim() || 'Goed',
      elite_goal: quickAddElite.trim() || 'Elite',
      is_active: true,
      sort_order: habits.length,
    });
    setQuickAddName(''); setQuickAddMini(''); setQuickAddGood(''); setQuickAddElite('');
    setQuickAddVisible(false);
    setQuickAddSaving(false);
    fetchData();
    showToast(`${quickAddName.trim()} toegevoegd!`, 'success');
  }

  // ── Derived data ─────────────────────────────────────────────────────────────

  const weekScore = useMemo(() => computeWeekScore(logs), [logs]);

  const habitData = useMemo(() => habits.map(habit => ({
    habit,
    log: getLog(habit.id, selectedDay),
    streak: computeStreak(habit.id, logs, selectedDay),
  })), [habits, logs, selectedDay]);

  const todayLogsCount = useMemo(() => logs.filter(l => l.date === today).length, [logs]);
  const allDoneToday   = habits.length > 0 && todayLogsCount >= habits.length;

  useEffect(() => {
    if (!allDoneToday) wasAllDone.current = false;
  }, [allDoneToday]);
  const selectedLogsCount = useMemo(() => logs.filter(l => l.date === selectedDay).length, [logs, selectedDay]);
  const allDoneSelected   = habits.length > 0 && selectedLogsCount >= habits.length;

  const completionPct = habits.length > 0 ? (selectedLogsCount / habits.length) : 0;
  const isPastDay = selectedDay < today;
  const isFutureDay = selectedDay > today;

  const bannerSubtitle = useMemo(() => {
    const overallStreak = computeOverallStreak(habits, logs);
    if (allDoneToday && overallStreak >= 3) return `🔥 ${overallStreak} dagen op rij!`;
    if (allDoneToday) return 'Alle habits voltooid!';
    if (overallStreak >= 7) return `🔥 ${overallStreak} days — fantastisch!`;
    if (overallStreak >= 3) return `🔥 ${overallStreak} dagen op rij`;
    if (todayLogsCount > 0) return `${todayLogsCount} van ${habits.length} vandaag`;
    return habits.length > 0 ? 'Begin je dag sterk' : '';
  }, [habits, logs, allDoneToday, todayLogsCount]);

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
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
          <Text style={[s.headerGreet, { color: colors.gray400 }]}>{getGreeting()}{settings.user_name ? `, ${settings.user_name}` : ''}</Text>
          <Text style={[s.headerTitle, { color: colors.black }]}>Habits</Text>
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
        {/* ── Clean warm header ── */}
        <View style={[s.header, { paddingTop: insets.top + 14 }]}>
          <Text style={[s.headerGreet, { color: colors.gray400 }]}>
            {getGreeting()}{settings.user_name ? `, ${settings.user_name}` : ''}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
            <Text style={[s.headerTitle, { color: colors.black }]}>Habits</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 }}>
              {habits.length > 0 && (
                <View style={{ flexDirection: 'row', backgroundColor: colors.gray100, borderRadius: 10, padding: 2 }}>
                  {(['day', 'week'] as const).map(m => (
                    <TouchableOpacity
                      key={m}
                      onPress={() => { haptic('light'); setViewMode(m); }}
                      style={{ paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: viewMode === m ? colors.surface : 'transparent' }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 12, color: viewMode === m ? colors.black : colors.gray400 }}>
                        {m === 'day' ? 'Dag' : 'Week'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>
          </View>
        </View>

        {/* ── Day strip (sc-weekstrip) ── */}
        {habits.length > 0 && (
          <FlatList
            ref={stripRef}
            data={strip}
            keyExtractor={d => d.date}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginTop: 10 }}
            contentContainerStyle={{ paddingHorizontal: 18, gap: 6 }}
            renderItem={({ item: day }) => {
              const isSelected = day.date === selectedDay;
              const isToday = day.date === today;
              const isFuture = day.date > today;
              const completion = stripDayCompletion(day.date);
              return (
                <TouchableOpacity
                  style={[
                    s.weekDay,
                    isToday && !isSelected && { backgroundColor: Colors.yellow },
                    isSelected && !isToday && { backgroundColor: colors.gray100 },
                    isFuture && { opacity: 0.4 },
                  ]}
                  onPress={() => { if (!isFuture) selectDay(day.date); }}
                  activeOpacity={isFuture ? 1 : 0.75}
                  hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                >
                  <Text style={[s.weekDayDow, { color: isToday && !isSelected ? 'rgba(0,0,0,0.55)' : colors.gray400 }]}>
                    {day.day.slice(0, 2)}
                  </Text>
                  <Text style={[s.weekDayNum, { color: isToday && !isSelected ? Colors.black : colors.black }]}>
                    {day.num}
                  </Text>
                  {completion === 'all'     && <View style={[s.weekDot, { backgroundColor: isToday && !isSelected ? 'rgba(0,0,0,0.45)' : Colors.yellow }]} />}
                  {completion === 'partial' && <View style={[s.weekDot, { backgroundColor: colors.gray200 }]} />}
                  {!completion              && <View style={s.weekDotEmpty} />}
                </TouchableOpacity>
              );
            }}
          />
        )}

        {habits.length === 0 ? (
          <View style={s.emptyContainer}>
            <View style={[s.emptyIcon, { backgroundColor: colors.gray100 }]}>
              <BreathingEmoji emoji="🏋️" size={36} />
            </View>
            <Text style={[s.emptyTitle, { color: colors.black }]}>Begin met habits</Text>
            <Text style={[s.emptyText, { color: colors.gray400 }]}>
              Voeg een habit toe via de + knop of via WhatsApp.
            </Text>
            <View style={[s.emptyStep, { backgroundColor: colors.white }]}>
              <Text style={s.emptyStepNum}>+</Text>
              <Text style={[s.emptyStepText, { color: colors.black }]}>
                Tik op de gele + knop rechtsonder
              </Text>
            </View>
            <View style={[s.emptyStep, { backgroundColor: colors.white }]}>
              <Text style={s.emptyStepNum}>💬</Text>
              <Text style={[s.emptyStepText, { color: colors.black }]}>
                Of stuur "voeg habit toe: mediteren" via WhatsApp
              </Text>
            </View>
            <View style={[s.emptyStep, { backgroundColor: colors.white }]}>
              <Text style={s.emptyStepNum}>🔥</Text>
              <Text style={[s.emptyStepText, { color: colors.black }]}>
                Log dagelijks en bouw je streak op
              </Text>
            </View>
          </View>
        ) : (
          <Animated.View style={[s.habitsList, { opacity: fadeAnim }]}>

            <Text style={[s.sectionLabel, { color: colors.gray400 }]}>
              {viewMode === 'week'
                ? `WEEK · ${habits.length} HABITS`
                : `${dayLabel(selectedDay).toUpperCase()} · ${habits.length} HABITS`}
            </Text>

            {viewMode === 'day' && allDoneSelected && <AllDoneCard day={selectedDay} />}

            {viewMode === 'day' ? habitData.map(({ habit, log }) => (
              <View key={habit.id} style={{ marginBottom: 10 }}>
                <SwipeDeleteRow onDelete={() => deleteHabit(habit.id)} borderRadius={Radius.lg}>
                  <Pressable
                    onLongPress={() => { haptic('medium'); setDetailHabit(habit); }}
                    onPress={() => setDetailHabit(habit)}
                  >
                    <HabitBarCard habit={habit} log={log} isToday={selectedDay === today} />
                  </Pressable>
                </SwipeDeleteRow>
              </View>
            )) : (
              <>
                {/* Week navigation */}
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, marginBottom: 6 }}>
                  <TouchableOpacity onPress={() => selectDay(utcDateStr(utcMsFromStr(selectedDay) - 7 * 86400000))} activeOpacity={0.7}>
                    <Ionicons name="chevron-back" size={22} color={colors.gray400} />
                  </TouchableOpacity>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>
                    {(() => {
                      const ms = utcMsFromStr(selectedDay);
                      const dow = (new Date(ms).getUTCDay() + 6) % 7;
                      const monMs = ms - dow * 86400000;
                      const sunMs = monMs + 6 * 86400000;
                      const fmt = (m: number) => new Date(m).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
                      return `${fmt(monMs)} – ${fmt(sunMs)}`;
                    })()}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      const next = utcDateStr(utcMsFromStr(selectedDay) + 7 * 86400000);
                      if (next <= today) selectDay(next);
                    }}
                    activeOpacity={0.7}
                    disabled={utcDateStr(utcMsFromStr(selectedDay) + 7 * 86400000) > today}
                  >
                    <Ionicons name="chevron-forward" size={22} color={utcDateStr(utcMsFromStr(selectedDay) + 7 * 86400000) > today ? colors.gray200 : colors.gray400} />
                  </TouchableOpacity>
                </View>
                <WeekGrid
                  habits={habits}
                  logs={logs}
                  loadingKey={loadingKey}
                  selectedDay={selectedDay}
                  onCycle={cycleHabit}
                  onDetail={setDetailHabit}
                />
              </>
            )}

          </Animated.View>
        )}
      </ScrollView>

      <Toast {...toastProps} />

      {/* Confetti burst */}
      <Confetti active={confettiActive} />

      {/* Streak milestone overlay */}
      {/* Habit detail modal */}
      <Modal visible={!!detailHabit} transparent animationType="slide" onRequestClose={() => setDetailHabit(null)}>
        <Pressable style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }} onPress={() => setDetailHabit(null)}>
          <Pressable style={[{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 16, gap: 12 }]} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.black, flex: 1, marginRight: 8 }} numberOfLines={2}>{detailHabit?.name}</Text>
              <TouchableOpacity onPress={() => setDetailHabit(null)}>
                <Ionicons name="close" size={22} color={colors.gray400} />
              </TouchableOpacity>
            </View>
            {([
              { key: 'mini' as const,  emoji: '⚡', label: 'Mini',  goal: detailHabit?.mini_goal,  color: '#22C55E' },
              { key: 'good' as const,  emoji: '⭐', label: 'Plus',  goal: detailHabit?.good_goal,  color: '#A9AFB7' },
              { key: 'elite' as const, emoji: '🏆', label: 'Elite', goal: detailHabit?.elite_goal, color: Colors.yellow },
            ] as const).map(lv => {
              const currentLog = detailHabit ? getLog(detailHabit.id, selectedDay) : undefined;
              const isActive = currentLog?.level === lv.key;
              return (
                <TouchableOpacity
                  key={lv.key}
                  onPress={() => { if (detailHabit) { logHabit(detailHabit, lv.key); setDetailHabit(null); } }}
                  activeOpacity={0.75}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg, borderWidth: 2, borderColor: isActive ? lv.color : colors.gray100, backgroundColor: isActive ? `${lv.color}18` : colors.gray100 }}
                >
                  <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: lv.color, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 17 }}>{lv.emoji}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.black }}>{lv.label}</Text>
                    {lv.goal ? <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.gray400, marginTop: 1 }}>{lv.goal}</Text> : null}
                  </View>
                  {isActive && <Ionicons name="checkmark-circle" size={22} color={lv.color} />}
                </TouchableOpacity>
              );
            })}
            {detailHabit && (() => {
              const currentLog = getLog(detailHabit.id, selectedDay);
              const isNotDone = currentLog?.level === 'not_done';
              return (
                <TouchableOpacity
                  onPress={() => {
                    if (!detailHabit) return;
                    if (currentLog && !isNotDone) {
                      supabase.from('habit_logs').update({ level: 'not_done', logged_at: new Date().toISOString() }).eq('id', currentLog.id).then(() => fetchData());
                      showToast(`${detailHabit.name} — Niet gedaan`, 'info');
                    } else if (isNotDone && currentLog) {
                      fetch(`${API_BASE}/habits/logs/${currentLog.id}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {});
                      showToast(`${detailHabit.name} verwijderd`, 'info');
                      fetchData();
                    } else {
                      supabase.from('habit_logs').upsert(
                        { habit_id: detailHabit.id, user_id: user?.id, date: selectedDay, level: 'not_done', logged_at: new Date().toISOString() },
                        { onConflict: 'habit_id,date' }
                      ).then(() => fetchData());
                      showToast(`${detailHabit.name} — Niet gedaan`, 'info');
                    }
                    setDetailHabit(null);
                  }}
                  style={{ alignItems: 'center', paddingVertical: 10, marginTop: 4 }}
                >
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: isNotDone ? colors.gray400 : '#EF4444' }}>
                    {isNotDone ? 'Verwijderen' : 'Niet gedaan'}
                  </Text>
                </TouchableOpacity>
              );
            })()}
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!milestoneStreak} transparent animationType="fade" onRequestClose={() => setMilestoneStreak(null)}>
        <Pressable style={mStyles.overlay} onPress={() => setMilestoneStreak(null)}>
          <Pressable style={[mStyles.milestoneCard, { backgroundColor: colors.white }]} onPress={() => {}}>
            <Text style={mStyles.milestoneEmoji}>🔥</Text>
            <Text style={[mStyles.milestoneNum, { color: colors.black }]}>{milestoneStreak?.streak} dagen!</Text>
            <Text style={[mStyles.milestoneName, { color: colors.black }]}>{milestoneStreak?.habitName}</Text>
            <Text style={[mStyles.milestoneSub, { color: colors.gray400 }]}>
              {milestoneStreak?.streak === 7 ? 'Een week op rij — geweldig!' :
               milestoneStreak?.streak === 14 ? 'Twee weken — je bent op dreef!' :
               milestoneStreak?.streak === 21 ? '21 dagen — het wordt een gewoonte!' :
               milestoneStreak?.streak === 30 ? 'Een maand! Je bent een held 🏆' :
               `${milestoneStreak?.streak} dagen — ongelooflijk!`}
            </Text>
            <TouchableOpacity onPress={() => setMilestoneStreak(null)} style={mStyles.milestoneBtn}>
              <Text style={mStyles.milestoneBtnText}>Doorgaan 💪</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Quick-add habit FAB */}
      <TouchableOpacity
        style={[mStyles.fab, { bottom: insets.bottom + 90 }]}
        onPress={() => setQuickAddVisible(true)}
        activeOpacity={0.85}
      >
        <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={mStyles.fabGrad}>
          <Ionicons name="add" size={26} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Quick-add habit sheet */}
      <Modal visible={quickAddVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setQuickAddVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={[{ flex: 1, backgroundColor: colors.white }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: insets.top + 16, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
              <TouchableOpacity onPress={() => setQuickAddVisible(false)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: colors.gray100 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.gray400 }}>Annuleer</Text>
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.black }}>Nieuwe habit</Text>
              <TouchableOpacity onPress={saveQuickAddHabit} disabled={!quickAddName.trim() || quickAddSaving} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.yellow, opacity: quickAddName.trim() ? 1 : 0.4 }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.black }}>Opslaan</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
              {[
                { label: 'Naam', value: quickAddName, setter: setQuickAddName, placeholder: 'Bijv. Mediteren, Lezen, Sporten...', autoFocus: true },
                { label: '⚡ Mini-doel', value: quickAddMini, setter: setQuickAddMini, placeholder: 'Bijv. 5 minuten' },
                { label: '⭐ Plus-doel', value: quickAddGood, setter: setQuickAddGood, placeholder: 'Bijv. 15 minuten' },
                { label: '🏆 Elite-doel', value: quickAddElite, setter: setQuickAddElite, placeholder: 'Bijv. 30 minuten' },
              ].map(field => (
                <View key={field.label} style={{ gap: 8 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>{field.label}</Text>
                  <TextInput
                    style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 14, color: colors.black, backgroundColor: colors.offWhite, fontFamily: 'Inter_400Regular', fontSize: 16 }}
                    value={field.value}
                    onChangeText={field.setter}
                    placeholder={field.placeholder}
                    placeholderTextColor={colors.gray400}
                    autoFocus={field.autoFocus}
                    selectionColor={Colors.yellow}
                  />
                </View>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Goal Chip ──────────────────────────────────────────────────────────────────

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

  // ── Clean header ──
  header: { paddingHorizontal: 22, paddingBottom: 10 },
  headerGreet: { fontFamily: 'Inter_400Regular', fontSize: 14.5, marginBottom: 3, letterSpacing: -0.1 },
  headerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 27, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 30 },
  streakBadgeHeader: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: Radius.pill, marginBottom: 2 },

  // ── Summary cards ──
  summaryRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 18, marginTop: 8, marginBottom: 4 },
  sumCard: { borderRadius: Radius.lg, padding: 16, ...Shadow.card },
  sumCardWide: { flex: 1 },
  sumBig: { fontFamily: 'Inter_700Bold', fontSize: 28, letterSpacing: -0.5, lineHeight: 32 },
  sumSmall: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 4 },
  sumMotiv: { fontFamily: 'Inter_600SemiBold', fontSize: 16, lineHeight: 22 },

  // ── Progress bar ──
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 18, marginTop: 12 },
  progressTrack: { flex: 1, height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressPct: { fontFamily: 'Inter_700Bold', fontSize: 12, minWidth: 32, textAlign: 'right' },

  // ── Day strip (sc-weekstrip) ──
  weekDay: { flex: 1, minWidth: 44, alignItems: 'center', paddingVertical: 9, paddingHorizontal: 5, borderRadius: 15 },
  weekDayDow: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.03, textTransform: 'uppercase' },
  weekDayNum: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: 4 },
  weekDot: { width: 5, height: 5, borderRadius: 3, marginTop: 5 },
  weekDotEmpty: { height: 10, marginTop: 5 },

  // ── Past notice ──
  pastNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 18, marginTop: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pastNoticeText: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.8, marginBottom: 8 },

  // ── Habit card (sc-hcard) ──
  habitsList: { padding: 18, gap: 14, paddingBottom: TAB_BAR_CLEARANCE },
  habitCard: { borderRadius: Radius.lg, ...Shadow.card, flexDirection: 'row', alignItems: 'center', padding: 16 },
  habitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  habitName: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.2, marginBottom: 2 },
  habitSub: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  medal: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, justifyContent: 'center', alignItems: 'center', flexShrink: 0 },

  streakChip: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4, flexShrink: 0 },
  streakChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  // ── Goal chips ──
  goalChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  goalChipEmoji: { fontSize: 11 },
  goalChipText: { fontFamily: 'Inter_300Light', fontSize: 11 },

  // ── Logged pill ──
  loggedPill: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  loggedPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.gray600 },

  // ── All done card ──
  allDoneCard: { borderRadius: Radius.lg, overflow: 'hidden', marginBottom: 4 },
  allDoneGradient: { padding: 20, alignItems: 'center' },
  allDoneEmoji: { fontSize: 40, marginBottom: 8 },
  allDoneTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.black, letterSpacing: -0.5 },
  allDoneSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(0,0,0,0.6)', marginTop: 4 },

  // ── Empty state ──
  emptyContainer: { padding: 32, alignItems: 'center', marginTop: 12 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 8 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  emptyStep: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: Radius.md, padding: 12, width: '100%', marginBottom: 8, ...Shadow.card },
  emptyStepNum: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.yellow, width: 24, textAlign: 'center' },
  emptyStepText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },

  skeletonList: { padding: 16 },
});

const mStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  milestoneCard: { width: '100%', borderRadius: Radius.xl, padding: 32, alignItems: 'center', gap: 8, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  milestoneEmoji: { fontSize: 60, marginBottom: 4 },
  milestoneNum: { fontFamily: 'Inter_700Bold', fontSize: 36, letterSpacing: -1 },
  milestoneName: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  milestoneSub: { fontFamily: 'Inter_300Light', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  milestoneBtn: { marginTop: 12, backgroundColor: Colors.yellow, borderRadius: Radius.pill, paddingHorizontal: 28, paddingVertical: 14 },
  milestoneBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },
  fab: { position: 'absolute', right: 20, width: 52, height: 52, borderRadius: 26, overflow: 'hidden', shadowColor: '#FCC10C', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  fabGrad: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});

const m = StyleSheet.create({
  card: { borderRadius: Radius.xl, padding: 16, ...Shadow.card, marginTop: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 6 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  subtitle: { fontFamily: 'Inter_300Light', fontSize: 12, textTransform: 'capitalize', marginTop: 2 },
  pctBadge: { backgroundColor: Colors.yellow, borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  pctText: { fontFamily: 'Inter_700Bold', fontSize: 12, color: Colors.black },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  statChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.gray100, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statChipIcon: { fontSize: 12 },
  statChipLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  weekRow: { flexDirection: 'row', marginBottom: 6 },
  weekLabel: { flex: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%` as any, alignItems: 'center', paddingVertical: 5 },
  cellNum: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 3 },
  dotPartial: { backgroundColor: '#FDE68A' },
  dotAll:     { backgroundColor: Colors.yellow },
  dotElite:   { backgroundColor: '#E5A800' },
  legend: { flexDirection: 'row', gap: 12, marginTop: 12, justifyContent: 'flex-end' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendLabel: { fontFamily: 'Inter_300Light', fontSize: 11 },
});
