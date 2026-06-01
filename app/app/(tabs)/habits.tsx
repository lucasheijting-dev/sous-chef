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
  Pressable,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
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

const STRIP_DAYS = new Date().getDate(); // covers all days this month up to today
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

function computeWeekScore(logs: HabitLog[]): number {
  const weekStart = strip[STRIP_DAYS - 7].date;
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

// ── Level Button ───────────────────────────────────────────────────────────────

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
          isActive && activeBg === Colors.yellow && { shadowColor: '#FCC10C', shadowOpacity: 0.5, shadowRadius: 10, shadowOffset: { width: 0, height: 2 }, elevation: 6 },
          { transform: [{ scale }] },
        ]}
      >
        <Text style={s.levelEmoji}>{emoji}</Text>
        <Text style={[s.levelLabel, { color: colors.gray600 }, isActive && { color: activeFg }]}>{label}</Text>
        {isActive && (
          <View style={s.levelCheck}>
            <Ionicons name="checkmark-circle" size={14} color={activeFg} />
          </View>
        )}
      </Animated.View>
    </TouchableOpacity>
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
      <View style={[s.banner, { paddingTop: insets.top + 40 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
        <Text style={s.bannerTitle}>Habits</Text>
        <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400, marginTop: 4 }}>{todayLabel[0].toUpperCase() + todayLabel.slice(1)}</Text>
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
  habit, log, streak, logs, selectedDay, loadingKey, onLog,
}: {
  habit: Habit;
  log: HabitLog | undefined;
  streak: number;
  logs: HabitLog[];
  selectedDay: string;
  loadingKey: string | null;
  onLog: (habit: Habit, level: 'mini' | 'good' | 'elite') => void;
}) {
  const { colors } = useTheme();
  const cardScale = useRef(new Animated.Value(1)).current;
  const burstScale = useRef(new Animated.Value(1)).current;
  const flashOpacity = useRef(new Animated.Value(0)).current;
  const prevLogLevel = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (log?.level && log.level !== prevLogLevel.current) {
      Animated.sequence([
        Animated.spring(burstScale, { toValue: 1.08, useNativeDriver: true, tension: 300, friction: 10 }),
        Animated.spring(burstScale, { toValue: 1,    useNativeDriver: true, tension: 300, friction: 10 }),
      ]).start();
      Animated.sequence([
        Animated.timing(flashOpacity, { toValue: 1, duration: 80,  useNativeDriver: true }),
        Animated.timing(flashOpacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start();
    }
    prevLogLevel.current = log?.level;
  }, [log?.level]);

  const isElite = log?.level === 'elite';
  const accentColor = log?.level === 'elite' ? Colors.yellow
    : log?.level === 'good'  ? '#6B7280'
    : log?.level === 'mini'  ? '#92400E'
    : colors.gray200;

  return (
    <Pressable
      onPressIn={() => Animated.spring(cardScale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
      onPressOut={() => Animated.spring(cardScale, { toValue: 1,    useNativeDriver: true, speed: 50 }).start()}
    >
      <Animated.View
        style={[
          s.habitCard,
          { backgroundColor: colors.white },
          isElite && { shadowColor: '#FCC10C', shadowOpacity: 0.25, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
          { transform: [{ scale: cardScale }, { scale: burstScale }] },
        ]}
      >
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { borderRadius: Radius.xl, backgroundColor: Colors.yellow, opacity: flashOpacity }]}
        />
        <View style={[s.accentBar, { backgroundColor: accentColor }]} />

        <View style={s.habitInner}>
          <View style={s.habitHeader}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: 10 }}>
                <Text style={[s.habitName, { color: colors.black }]}>{habit.name}</Text>
                <View style={[s.streakChip, { backgroundColor: colors.gray100 }]}>
                  <Text style={[s.streakChipText, { color: colors.gray600 }]}>
                    🔥 {streak > 0 ? streak : '—'}
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                <CompletionRing level={log?.level} />
                {streak > 0 && (
                  <Text style={[s.streakBadge, { color: colors.gray400 }]}>
                    {streak} {streak === 1 ? 'dag' : 'dagen'} op rij
                  </Text>
                )}
              </View>
              <SparkLine habitId={habit.id} logs={logs} />
            </View>
            <LoggedPill log={log} />
          </View>

          <View style={[s.cardDivider, { backgroundColor: colors.gray100 }]} />

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
                  onPress={() => onLog(habit, lvl.key)}
                  isLoading={loadingKey === btnKey}
                />
              );
            })}
          </View>

          <View style={s.goalsRow}>
            <GoalChip emoji="🥉" text={habit.mini_goal} colors={colors} />
            <GoalChip emoji="🥈" text={habit.good_goal} colors={colors} />
            <GoalChip emoji="🥇" text={habit.elite_goal} colors={colors} />
          </View>
        </View>
      </Animated.View>
    </Pressable>
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
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { fetchData(); }, [fetchData]);

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
      await supabase.from('habit_logs').delete().eq('id', existing.id);
      showToast(`${habit.name} ongedaan gemaakt`, 'info');
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
        <View style={[s.banner, { paddingTop: insets.top + 44 }]}>
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
        <View style={[s.banner, { paddingTop: insets.top + 44 }]}>
          <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />

          <View style={s.bannerTop}>
            <Text style={s.bannerTitle}>{allDoneToday ? '🏆 Habits' : 'Habits'}</Text>
          </View>
          <View style={s.bannerStats}>
            <View style={s.statTile}>
              <AnimatedCounter value={habits.length} style={s.statNum} />
              <Text style={s.statLabel}>{habits.length === 1 ? 'habit' : 'habits'}</Text>
            </View>
            {weekScore > 0 && (
              <View style={[s.statTile, s.statTileAccent]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[s.statNum, { color: Colors.black }]}>⭐</Text>
                  <AnimatedCounter value={weekScore} style={[s.statNum, { color: Colors.black }]} />
                </View>
                <Text style={[s.statLabel, { color: 'rgba(0,0,0,0.55)' }]}>punten deze week</Text>
              </View>
            )}
            {bannerSubtitle && weekScore === 0 && (
              <View style={s.statTile}>
                <Text style={[s.statLabel, { color: Colors.yellow, fontSize: 13 }]}>{bannerSubtitle}</Text>
              </View>
            )}
          </View>

          {habits.length > 0 && (
            <View style={s.progressBarWrap}>
              <View style={[s.progressBarTrack, { backgroundColor: 'rgba(255,255,255,0.12)' }]}>
                <View style={[s.progressBarFill, { width: `${Math.round(completionPct * 100)}%` as any }]} />
              </View>
              <Text style={s.progressPct}>{Math.round(completionPct * 100)}%</Text>
            </View>
          )}

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
                    isFuture && { opacity: 0.4 },
                  ]}
                  onPress={() => { if (!isFuture) selectDay(day.date); }}
                  activeOpacity={isFuture ? 1 : 0.75}
                  hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
                >
                  <Text style={[s.dayLabel, isSelected && s.dayLabelActive]}>
                    {isToday && !isSelected ? 'Vand.' : day.day}
                  </Text>
                  <View style={[s.dayNumBox, isToday && !isSelected && s.dayNumToday]}>
                    <Text style={[s.dayNum, isSelected && s.dayNumActive, isToday && !isSelected && { color: Colors.yellow }]}>
                      {day.num}
                    </Text>
                  </View>
                  {completion === 'all'     && <View style={[s.completionDot, isSelected ? s.completionDotSelected : s.completionDotAll]} />}
                  {completion === 'partial' && <View style={[s.completionDot, isSelected ? s.completionDotSelected : s.completionDotPartial]} />}
                  {!completion              && <View style={s.completionPlaceholder} />}
                </TouchableOpacity>
              );
            }}
          />
        </View>

        {isPastDay && (
          <View style={[s.pastNotice, { backgroundColor: colors.gray100 }]}>
            <Ionicons name="time-outline" size={13} color={colors.gray400} />
            <Text style={[s.pastNoticeText, { color: colors.gray400 }]}>
              Je bekijkt {dayLabel(selectedDay).toLowerCase()}
            </Text>
          </View>
        )}

        {habits.length === 0 ? (
          <View style={s.emptyContainer}>
            <View style={[s.emptyIcon, { backgroundColor: colors.gray100 }]}>
              <BreathingEmoji emoji="🏋️" size={36} />
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

            <Text style={[s.sectionLabel, { color: colors.gray400 }]}>
              {dayLabel(selectedDay).toUpperCase()} · {habits.length} HABITS
            </Text>

            {allDoneSelected && <AllDoneCard day={selectedDay} />}

            {habitData.map(({ habit, log, streak }) => (
              <HabitCard
                key={habit.id}
                habit={habit}
                log={log}
                streak={streak}
                logs={logs}
                selectedDay={selectedDay}
                loadingKey={loadingKey}
                onLog={logHabit}
              />
            ))}

            <MonthOverview
              habits={habits}
              monthLogs={monthLogs}
              onDayPress={(d) => {
                selectDay(d);
                const idx = strip.findIndex(s => s.date === d);
                if (idx >= 0) stripRef.current?.scrollToIndex({ index: idx, animated: true });
              }}
            />
          </Animated.View>
        )}
      </ScrollView>

      <Toast {...toastProps} />

      {/* Confetti burst */}
      <Confetti active={confettiActive} />

      {/* Streak milestone overlay */}
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
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={mStyles.fabGrad}>
          <Ionicons name="add" size={26} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>

      {/* Quick-add habit sheet */}
      <Modal visible={quickAddVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setQuickAddVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <View style={[{ flex: 1, backgroundColor: colors.white }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
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
                { label: '🥉 Mini-doel', value: quickAddMini, setter: setQuickAddMini, placeholder: 'Bijv. 5 minuten' },
                { label: '🥈 Goed-doel', value: quickAddGood, setter: setQuickAddGood, placeholder: 'Bijv. 15 minuten' },
                { label: '🥇 Elite-doel', value: quickAddElite, setter: setQuickAddElite, placeholder: 'Bijv. 30 minuten' },
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

  banner: { paddingHorizontal: 24, paddingBottom: 28, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  bannerTop: { marginBottom: 14 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 30, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase' },
  bannerStats: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  statTile: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFFFFF0F', borderRadius: 16, borderWidth: 1, borderColor: '#FFFFFF16', minWidth: 96 },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum: { fontFamily: 'Inter_700Bold', fontSize: 21, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  progressBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  progressBarTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  progressBarFill: { height: '100%', backgroundColor: Colors.yellow, borderRadius: 2 },
  progressPct: { fontFamily: 'Inter_700Bold', fontSize: 11, color: 'rgba(255,255,255,0.5)', minWidth: 30, textAlign: 'right' },

  dayPill: { alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: Radius.md, width: 46 },
  dayPillSelected: { backgroundColor: Colors.yellow },
  dayLabel: { fontFamily: 'Inter_300Light', fontSize: 8, color: 'rgba(255,255,255,0.5)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: 0.3 },
  dayLabelActive: { color: Colors.black },
  dayNumBox: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  dayNumToday: { borderWidth: 1.5, borderColor: Colors.yellow },
  dayNum: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: 'rgba(255,255,255,0.6)' },
  dayNumActive: { color: Colors.black },
  completionDot: { width: 6, height: 6, borderRadius: 3, marginTop: 4 },
  completionDotAll:      { backgroundColor: Colors.yellow },
  completionDotPartial:  { backgroundColor: 'rgba(255,255,255,0.4)' },
  completionDotSelected: { backgroundColor: Colors.black },
  completionPlaceholder: { height: 10, marginTop: 4 },

  pastNotice: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 20, marginTop: 10, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pastNoticeText: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  sectionLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.8, marginBottom: 8 },

  habitsList: { padding: 20, gap: 16, paddingBottom: TAB_BAR_CLEARANCE },
  habitCard: { borderRadius: Radius.xl, overflow: 'hidden', flexDirection: 'row', ...Shadow.card },
  habitInner: { flex: 1, padding: 18 },

  accentBar: { width: 4 },

  habitHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 },
  habitName: { fontFamily: 'Inter_700Bold', fontSize: 17, marginRight: 8, marginBottom: 0, flexShrink: 1 },

  streakChip: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 3, flexShrink: 0 },
  streakChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },

  streakBadge: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  cardDivider: { height: 1, marginBottom: 12 },

  levelRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  levelBtnTouch: { flex: 1 },
  levelBtn: {
    alignItems: 'center', paddingVertical: 14, borderRadius: Radius.md,
    borderWidth: 1.5, minHeight: 68, justifyContent: 'center', position: 'relative',
  },
  levelEmoji: { fontSize: 22, marginBottom: 4 },
  levelLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  levelCheck: { position: 'absolute', top: 5, right: 5 },

  loggedPill: { borderRadius: Radius.pill, paddingHorizontal: 10, paddingVertical: 5 },
  loggedPillText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.gray600 },

  goalsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  goalChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  goalChipEmoji: { fontSize: 11 },
  goalChipText: { fontFamily: 'Inter_300Light', fontSize: 11 },

  allDoneCard: { borderRadius: Radius.xl, overflow: 'hidden', marginBottom: 4 },
  allDoneGradient: { padding: 20, alignItems: 'center' },
  allDoneEmoji: { fontSize: 40, marginBottom: 8 },
  allDoneTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.black, letterSpacing: -0.5 },
  allDoneSub: { fontFamily: 'Inter_400Regular', fontSize: 14, color: 'rgba(0,0,0,0.6)', marginTop: 4 },

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
