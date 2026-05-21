import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import {
  View,
  Text,
  FlatList,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Platform,
  TouchableOpacity,
  Pressable,
  Linking,
  Alert,
  PanResponder,
  Animated,
  Modal,
  SafeAreaView,
  LayoutAnimation,
  Dimensions,
  TextInput as TextInputRN,
  KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Calendar from 'expo-calendar';
import { Swipeable } from 'react-native-gesture-handler';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { CalEvent } from '@/lib/types';
import { Colors, Radius, Shadow, ThemeColors, TAB_BAR_CLEARANCE } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';

type CalendarStream = { id: string; claude_key: string; color: string; name: string; emoji: string };

type MergedEvent = {
  id: string; title: string; date: string | null; time?: string | null;
  recurrence?: string | null; reminder_days_before?: number;
  calendar_stream?: string | null;
  source: 'sous-chef' | 'phone';
};
type Section  = { dateKey: string; label: string; isToday: boolean; isPast: boolean; data: MergedEvent[] };
type FlatItem = { type: 'header'; section: Section } | { type: 'item'; item: MergedEvent; section: Section; isLast: boolean };
type ViewMode   = 'list' | 'calendar';
type TimePeriod = 'today' | 'tomorrow' | 'thisweek' | 'nextweek';

const TODAY              = new Date().toISOString().split('T')[0];
const SECTION_H          = 48;
const CARD_H             = 84;
const MONTH_H            = 560;
const MONTHS_BEFORE      = 6;
const MONTHS_AFTER       = 18;
const { width: screenWidth } = Dimensions.get('window');

const PERIOD_ORDER: TimePeriod[] = ['today', 'tomorrow', 'thisweek', 'nextweek'];

// ── Helpers ────────────────────────────────────────────────────────────────────

function toKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function sectionLabel(dateKey: string): string {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const d = new Date(dateKey + 'T00:00:00');
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  if (diff === 0)  return 'Vandaag';
  if (diff === 1)  return 'Morgen';
  if (diff === -1) return 'Gisteren';
  const wd = d.toLocaleDateString('nl-NL', { weekday: 'long' });
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${d.getDate()} ${d.toLocaleDateString('nl-NL', { month: 'long' })}`;
}

function eventEmoji(title: string): string {
  const t = title.toLowerCase();
  if (t.includes('verjaardag') || t.includes('birthday')) return '🎂';
  if (t.includes('tandarts'))  return '🦷';
  if (t.includes('dokter') || t.includes('huisarts')) return '🏥';
  if (t.includes('sport') || t.includes('gym') || t.includes('fitness')) return '🏃';
  if (t.includes('vergadering') || t.includes('meeting')) return '💼';
  if (t.includes('vlucht') || t.includes('vakantie') || t.includes('reis')) return '✈️';
  if (t.includes('eten') || t.includes('restaurant') || t.includes('diner')) return '🍽️';
  if (t.includes('bruiloft') || t.includes('trouw')) return '💍';
  return '📅';
}

function daysUntil(dateKey: string): string | null {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(dateKey + 'T00:00:00').getTime() - today.getTime()) / 86400000);
  if (diff === 0) return null;
  if (diff > 0 && diff <= 30) return `over ${diff}d`;
  if (diff < 0) return `${Math.abs(diff)}d geleden`;
  return null;
}

function isPast(dateStr: string): boolean {
  return new Date(dateStr + 'T23:59:59') < new Date();
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getEventColor(event: MergedEvent, streams: CalendarStream[]): string {
  if (event.source === 'phone') return '#007AFF';
  const stream = streams.find(s => s.claude_key === event.calendar_stream);
  return stream?.color ?? '#4A90D9';
}

function parseTime(t: string): { h: number; m: number } {
  const [hStr, mStr] = t.split(':');
  return { h: parseInt(hStr) || 0, m: parseInt(mStr) || 0 };
}

function groupByDate(events: MergedEvent[]): Section[] {
  const map = new Map<string, MergedEvent[]>();
  for (const e of events) {
    const key = e.date ?? 'unknown';
    if (key === 'unknown') continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(e);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([dateKey, data]) => ({ dateKey, label: sectionLabel(dateKey), isToday: dateKey === TODAY, isPast: dateKey < TODAY, data }));
}

async function fetchPhoneEvents(): Promise<MergedEvent[]> {
  if (Platform.OS === 'web') return [];
  const { status } = await Calendar.requestCalendarPermissionsAsync();
  if (status !== 'granted') return [];
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const end = new Date(); end.setDate(end.getDate() + 90);
  const evts = await Calendar.getEventsAsync(cals.map(c => c.id), start, end);
  return evts.map(e => ({
    id: `phone-${e.id}`, title: e.title,
    date: e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : null,
    source: 'phone' as const,
  }));
}

// ── Month grid ─────────────────────────────────────────────────────────────────

function MonthGrid({ year, month, eventsByDate, selectedDate, onDayPress, streams, weekStart }: {
  year: number; month: number; eventsByDate: Map<string, MergedEvent[]>;
  selectedDate: string; onDayPress: (k: string) => void; streams: CalendarStream[];
  weekStart: 'monday' | 'sunday';
}) {
  const { colors } = useTheme();
  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  // leadingBlanks: how many empty cells before the 1st of the month
  const leadingBlanks = weekStart === 'monday'
    ? (firstDow === 0 ? 6 : firstDow - 1)  // Mon-based: Sun→6
    : firstDow;                              // Sun-based: Sun→0

  const DAY_HEADERS = weekStart === 'monday'
    ? ['Ma','Di','Wo','Do','Vr','Za','Zo']
    : ['Zo','Ma','Di','Wo','Do','Vr','Za'];
  const WEEKEND_INDICES = weekStart === 'monday' ? [5, 6] : [0, 6];

  const allDays: (null | { key: string; num: number; isToday: boolean; isWeekend: boolean })[] = [];
  for (let b = 0; b < leadingBlanks; b++) allDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toKey(new Date(year, month, d));
    const dow = new Date(year, month, d).getDay();
    const colIndex = weekStart === 'monday'
      ? (dow === 0 ? 6 : dow - 1)
      : dow;
    allDays.push({ key, num: d, isToday: key === TODAY, isWeekend: WEEKEND_INDICES.includes(colIndex) });
  }
  while (allDays.length % 7 !== 0) allDays.push(null);

  const weeks: typeof allDays[] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  const label = new Date(year, month, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

  return (
    <View style={{ backgroundColor: colors.white, marginBottom: 1 }}>
      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.black, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 }}>
        {label[0].toUpperCase() + label.slice(1)}
      </Text>
      <View style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
        <View style={{ width: 28 }} />
        {DAY_HEADERS.map((n, i) => (
          <Text key={n} style={{ flex: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 11, color: WEEKEND_INDICES.includes(i) ? colors.gray200 : colors.gray400, paddingBottom: 6 }}>{n}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => {
        const firstValid = week.find(d => d !== null);
        const weekNum = firstValid ? getWeekNumber(new Date(firstValid.key + 'T12:00:00')) : null;
        return (
          <View key={wi} style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100, minHeight: 76 }}>
            <View style={{ width: 28, paddingTop: 10, alignItems: 'center' }}>
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 9, color: colors.gray200 }}>{weekNum}</Text>
            </View>
            {week.map((day, di) => {
              if (day === null) return <View key={di} style={{ flex: 1 }} />;
              const events = eventsByDate.get(day.key) ?? [];
              const isSelected = selectedDate === day.key;
              const isPastDay = day.key < TODAY;
              return (
                <TouchableOpacity key={day.key} style={{ flex: 1, paddingTop: 6, paddingBottom: 4, paddingHorizontal: 1, alignItems: 'stretch' }} onPress={() => onDayPress(day.key)} activeOpacity={0.7}>
                  <View style={{
                    width: 26, height: 26, borderRadius: 13,
                    backgroundColor: day.isToday ? Colors.yellow : (isSelected && !day.isToday ? colors.black : 'transparent'),
                    justifyContent: 'center', alignItems: 'center', alignSelf: 'center', marginBottom: 3,
                  }}>
                    <Text style={{
                      fontFamily: (day.isToday || isSelected) ? 'Inter_700Bold' : 'Inter_400Regular',
                      fontSize: 13,
                      color: (day.isToday || isSelected) ? Colors.black : isPastDay ? colors.gray200 : day.isWeekend ? colors.gray400 : colors.black,
                    }}>{day.num}</Text>
                  </View>
                  {events.slice(0, 2).map((e) => {
                    const color = getEventColor(e, streams);
                    return (
                      <View key={e.id} style={{ backgroundColor: color, borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1.5, marginBottom: 2, marginHorizontal: 1 }}>
                        <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', fontSize: 8.5, color: '#fff', lineHeight: 11 }}>
                          {e.time ? e.time.slice(0, 5) + ' ' : ''}{e.title}
                        </Text>
                      </View>
                    );
                  })}
                  {events.length > 2 && (
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 9, color: colors.gray400, paddingHorizontal: 3 }}>+{events.length - 2}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

const DEFAULT_STREAMS: CalendarStream[] = [
  { id: '__persoonlijk', claude_key: 'persoonlijk', color: '#4A90D9', name: 'Persoonlijk', emoji: '👤' },
  { id: '__werk',        claude_key: 'werk',        color: '#E67E22', name: 'Werk',        emoji: '💼' },
  { id: '__familie',     claude_key: 'familie',     color: '#27AE60', name: 'Familie',     emoji: '👨‍👩‍👧' },
  { id: '__gezondheid',  claude_key: 'gezondheid',  color: '#E74C3C', name: 'Gezondheid',  emoji: '🏥' },
];

// ── AgendaLite (period pills + stream chips) ──────────────────────────────────

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

function AgendaLite() {
  const { user }   = useUser();
  const { colors } = useTheme();
  const insets     = useSafeAreaInsets();

  const [allEvents, setAllEvents]         = useState<MergedEvent[]>([]);
  const [streams, setStreams]             = useState<CalendarStream[]>([]);
  const [loading, setLoading]             = useState(true);
  const [timePeriod, setTimePeriod]       = useState<TimePeriod>('today');
  const [streamFilter, setStreamFilter]   = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<MergedEvent | null>(null);
  const [deleteTarget, setDeleteTarget]   = useState<MergedEvent | null>(null);
  const liteScrollRef                     = useRef<ScrollView>(null);
  const chipScrollRef                     = useRef<ScrollView>(null);
  const breatheAnim                       = useRef(new Animated.Value(1)).current;
  const scrollYAnim                       = useRef(new Animated.Value(0)).current;

  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [quickAddTitle, setQuickAddTitle]     = useState('');
  const [quickAddDate, setQuickAddDate]       = useState<Date>(new Date());
  const [quickAddTime, setQuickAddTime]       = useState<Date | null>(null);
  const [quickAddSaving, setQuickAddSaving]   = useState(false);
  const [showDatePicker, setShowDatePicker]   = useState(false);
  const [showTimePicker, setShowTimePicker]   = useState(false);

  const [editEvent, setEditEvent]             = useState<MergedEvent | null>(null);
  const [editTitle, setEditTitle]             = useState('');
  const [editDate, setEditDate]               = useState<Date>(new Date());
  const [editTime, setEditTime]               = useState<Date | null>(null);
  const [editShowDatePicker, setEditShowDatePicker] = useState(false);
  const [editShowTimePicker, setEditShowTimePicker] = useState(false);
  const [editSaving, setEditSaving]           = useState(false);

  // drag state for timeline
  const [dragEvent, setDragEvent]             = useState<MergedEvent | null>(null);
  const [dragY, setDragY]                     = useState(0);
  const dragTimeRef                           = useRef<string | null>(null);

  const [viewMode, setViewMode]           = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate]   = useState(TODAY);
  const [dayDetailMode, setDayDetailMode] = useState(false);
  const monthsRef = useRef<FlatList>(null);
  const { settings } = useModuleSettings();

  // Center on current month whenever calendar grid becomes visible
  useEffect(() => {
    if (viewMode === 'calendar' && !dayDetailMode) {
      setTimeout(() => monthsRef.current?.scrollToIndex({ index: MONTHS_BEFORE, animated: false }), 60);
    }
  }, [viewMode, dayDetailMode]);

  const daySwipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) =>
        Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.8,
      onPanResponderRelease: (_, g) => {
        if (Math.abs(g.dx) < 50) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        if (g.dx < 0) {
          setSelectedDate(prev => { const d = new Date(prev + 'T12:00:00'); d.setDate(d.getDate() + 1); return toKey(d); });
        } else {
          setSelectedDate(prev => { const d = new Date(prev + 'T12:00:00'); d.setDate(d.getDate() - 1); return toKey(d); });
        }
      },
    })
  ).current;

  const PERIOD_LABELS: [TimePeriod, string][] = [
    ['today', 'Vandaag'],
    ['tomorrow', 'Morgen'],
    ['thisweek', 'Deze week'],
    ['nextweek', 'Volgende week'],
  ];

  const EMPTY_STATE: Record<TimePeriod, { emoji: string; title: string; sub: string }> = {
    today:    { emoji: '🎉', title: 'Vandaag vrij!',       sub: 'Niets ingepland. Geniet ervan.' },
    tomorrow: { emoji: '😴', title: 'Morgen nog niks',     sub: 'Stuur "tandarts morgen 14u" via WhatsApp.' },
    thisweek: { emoji: '🌤️', title: 'Rustige week',        sub: 'Nog geen afspraken deze week.' },
    nextweek: { emoji: '📭', title: 'Volgende week leeg',  sub: 'Nog niets gepland voor volgende week.' },
  };

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(breatheAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breatheAnim]);

  useEffect(() => {
    if (!user || user.id === 'dev') { setLoading(false); return; }

    fetch(`${API_BASE}/calendar-sync/${user.id}`, { method: 'POST' }).catch(() => {});

    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setFullYear(end.getFullYear() + 1);
    const endKey = toKey(end);

    Promise.all([
      supabase.from('events').select('*').eq('user_id', user.id).gte('date', TODAY).lte('date', endKey),
      supabase.from('calendar_streams').select('*').eq('user_id', user.id),
    ]).then(([evtRes, streamRes]) => {
      const scEvents: MergedEvent[] = (evtRes.data ?? []).map((e: CalEvent) => ({ ...e, source: 'sous-chef' as const }));
      if (streamRes.data) setStreams(streamRes.data);

      if (Platform.OS !== 'web') {
        Calendar.getCalendarPermissionsAsync().then(({ status }) => {
          if (status !== 'granted') { setAllEvents(scEvents); setLoading(false); return; }
          Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT).then(cals => {
            const start2 = new Date(now); start2.setHours(0, 0, 0, 0);
            const end2   = new Date(now); end2.setFullYear(end2.getFullYear() + 1);
            Calendar.getEventsAsync(cals.map(c => c.id), start2, end2).then(phoneEvts => {
              const scKeys = new Set(scEvents.map(e => `${e.title?.toLowerCase()}|${e.date}`));
              const merged: MergedEvent[] = phoneEvts
                .filter(e => !scKeys.has(`${e.title?.toLowerCase()}|${e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : ''}`))
                .map(e => ({
                  id: `phone-${e.id}`, title: e.title,
                  date: e.startDate ? toKey(new Date(e.startDate)) : null,
                  time: e.startDate && !e.allDay ? new Date(e.startDate).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : null,
                  source: 'phone' as const,
                }));
              setAllEvents([...scEvents, ...merged]);
              setLoading(false);
            });
          });
        });
      } else {
        setAllEvents(scEvents);
        setLoading(false);
      }
    });
  }, [user]);

  const periodCounts = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const offsetDay = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return toKey(d); };
    const ranges: Record<TimePeriod, [string, string]> = {
      today:    [offsetDay(0), offsetDay(0)],
      tomorrow: [offsetDay(1), offsetDay(1)],
      thisweek: [offsetDay(0), offsetDay(6)],
      nextweek: [offsetDay(7), offsetDay(13)],
    };
    const counts: Record<TimePeriod, number> = { today: 0, tomorrow: 0, thisweek: 0, nextweek: 0 };
    for (const p of PERIOD_ORDER) {
      const [start, end] = ranges[p];
      counts[p] = allEvents.filter(e => e.date && e.date >= start && e.date <= end).length;
    }
    return counts;
  }, [allEvents]);

  const visibleEvents = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const offsetDay = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return toKey(d); };
    const ranges: Record<TimePeriod, [string, string]> = {
      today:    [offsetDay(0), offsetDay(0)],
      tomorrow: [offsetDay(1), offsetDay(1)],
      thisweek: [offsetDay(0), offsetDay(6)],
      nextweek: [offsetDay(7), offsetDay(13)],
    };
    const [start, end] = ranges[timePeriod];
    let evts = allEvents.filter(e => e.date && e.date >= start && e.date <= end);
    if (streamFilter) evts = evts.filter(e => e.calendar_stream === streamFilter);
    return evts;
  }, [allEvents, timePeriod, streamFilter]);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTHS_BEFORE + 1 + MONTHS_AFTER }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - MONTHS_BEFORE + i, 1);
      return { year: d.getFullYear(), month: d.getMonth(), index: i };
    });
  }, []);

  const eventsByDate = useMemo(() => {
    const m = new Map<string, MergedEvent[]>();
    for (const e of allEvents) {
      if (!e.date) continue;
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [allEvents]);
  const selectedDayEvents = useMemo(() => allEvents.filter(e => e.date === selectedDate), [allEvents, selectedDate]);

  function selectPeriod(p: TimePeriod) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTimePeriod(p);
    setStreamFilter(null);
    const index = PERIOD_ORDER.indexOf(p);
    chipScrollRef.current?.scrollTo({ x: Math.max(0, index * 90 - screenWidth / 2 + 45), animated: true });
  }

  const swipePanResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 10 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderRelease: (_, g) => {
        if (g.dx < -60) {
          setTimePeriod(prev => {
            const idx = PERIOD_ORDER.indexOf(prev);
            const next = PERIOD_ORDER[Math.min(idx + 1, PERIOD_ORDER.length - 1)];
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            const ni = PERIOD_ORDER.indexOf(next);
            chipScrollRef.current?.scrollTo({ x: Math.max(0, ni * 90 - screenWidth / 2 + 45), animated: true });
            return next;
          });
        } else if (g.dx > 60) {
          setTimePeriod(prev => {
            const idx = PERIOD_ORDER.indexOf(prev);
            const next = PERIOD_ORDER[Math.max(idx - 1, 0)];
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            const ni = PERIOD_ORDER.indexOf(next);
            chipScrollRef.current?.scrollTo({ x: Math.max(0, ni * 90 - screenWidth / 2 + 45), animated: true });
            return next;
          });
        }
      },
    })
  ).current;

  async function deleteEvent(event: MergedEvent) {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    if (event.source === 'sous-chef') {
      await supabase.from('events').delete().eq('id', event.id);
    } else if (event.source === 'phone' && Platform.OS !== 'web') {
      try { await Calendar.deleteEventAsync(event.id.replace('phone-', '')); } catch (_) {}
    }
    setAllEvents(prev => prev.filter(e => e.id !== event.id));
    setDeleteTarget(null);
  }

  const bannerTranslateY = scrollYAnim.interpolate({
    inputRange: [0, 100],
    outputRange: [0, -20],
    extrapolate: 'clamp',
  });

  function openQuickAdd(prefillDate?: string) {
    const d = prefillDate ? new Date(prefillDate + 'T12:00:00') : new Date();
    setQuickAddTitle('');
    setQuickAddDate(d);
    setQuickAddTime(null);
    setShowDatePicker(false);
    setShowTimePicker(false);
    setQuickAddVisible(true);
  }

  async function saveQuickEvent() {
    if (!user || !quickAddTitle.trim() || quickAddSaving) return;
    setQuickAddSaving(true);
    const dateStr = toKey(quickAddDate);
    const timeStr = quickAddTime
      ? `${String(quickAddTime.getHours()).padStart(2,'0')}:${String(quickAddTime.getMinutes()).padStart(2,'0')}`
      : null;
    const { data } = await supabase.from('events').insert({
      user_id: user.id, title: quickAddTitle.trim(), date: dateStr, time: timeStr,
    }).select().single();
    if (data) setAllEvents(prev => [...prev, { ...data, source: 'sous-chef' as const }]);
    setQuickAddVisible(false);
    setQuickAddSaving(false);
  }

  function openEditEvent(e: MergedEvent) {
    setEditEvent(e);
    setEditTitle(e.title);
    setEditDate(e.date ? new Date(e.date + 'T12:00:00') : new Date());
    if (e.time) {
      const [h, m] = e.time.split(':').map(Number);
      const t = new Date(); t.setHours(h, m, 0, 0);
      setEditTime(t);
    } else {
      setEditTime(null);
    }
    setEditShowDatePicker(false);
    setEditShowTimePicker(false);
  }

  async function saveEditEvent() {
    if (!editEvent || !editTitle.trim() || editSaving) return;
    setEditSaving(true);
    const dateStr = toKey(editDate);
    const timeStr = editTime
      ? `${String(editTime.getHours()).padStart(2,'0')}:${String(editTime.getMinutes()).padStart(2,'0')}`
      : null;
    if (editEvent.source === 'sous-chef') {
      await supabase.from('events').update({ title: editTitle.trim(), date: dateStr, time: timeStr }).eq('id', editEvent.id);
    }
    setAllEvents(prev => prev.map(e => e.id === editEvent.id ? { ...e, title: editTitle.trim(), date: dateStr, time: timeStr } : e));
    setEditEvent(null);
    setEditSaving(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
      {/* Header */}
      <Animated.View style={[s.banner, { paddingTop: insets.top + 44, transform: [{ translateY: bannerTranslateY }] }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
        <View style={s.bannerRow}>
          <Text style={s.bannerTitle}>Agenda</Text>
          <TouchableOpacity
            onPress={() => { setViewMode(v => v === 'list' ? 'calendar' : 'list'); setDayDetailMode(false); }}
            style={{ padding: 8, marginRight: -4 }}
            activeOpacity={0.7}
          >
            <Ionicons
              name={viewMode === 'list' ? 'calendar-outline' : 'list-outline'}
              size={26}
              color="rgba(255,255,255,0.85)"
            />
          </TouchableOpacity>
        </View>
      </Animated.View>

      {/* ── List view ──────────────────────────────────────────────────── */}
      {viewMode === 'list' && <>

      {/* Period pills */}
      <View style={{ flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 10 }}>
        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Periode</Text>
        <ScrollView ref={chipScrollRef} horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {PERIOD_LABELS.map(([p, label]) => {
            const count = periodCounts[p];
            const active = timePeriod === p;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => selectPeriod(p)}
                style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, backgroundColor: active ? Colors.yellow : '#DDDCDC' }}
              >
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111', lineHeight: 18 }}>
                  {label}{' '}
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: count === 0 ? '#aaa' : '#333' }}>
                    ({count})
                  </Text>
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Separator */}
      <View style={{ height: 1, backgroundColor: '#E8E8E8', marginHorizontal: 20, marginTop: 4, marginBottom: 4 }} />

      {/* Category chips */}
      {(() => {
        const userKeys = new Set(streams.map(s => s.claude_key));
        const mergedStreams = [
          ...DEFAULT_STREAMS.filter(d => !userKeys.has(d.claude_key)),
          ...streams,
        ];
        return (
          <View style={{ flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 16 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Categorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStreamFilter(null); }} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === null ? Colors.yellow : '#DDDCDC' }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111', lineHeight: 18 }}>Alles</Text>
              </TouchableOpacity>
              {mergedStreams.map(st => (
                <TouchableOpacity key={st.id} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStreamFilter(streamFilter === st.claude_key ? null : st.claude_key); }} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === st.claude_key ? st.color : '#DDDCDC' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: streamFilter === st.claude_key ? '#fff' : '#111', lineHeight: 18 }}>{st.emoji} {st.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        );
      })()}

      {/* Events */}
      <Animated.ScrollView
        ref={liteScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: TAB_BAR_CLEARANCE }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollYAnim } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        {...swipePanResponder.panHandlers}
      >
        {loading ? (
          <ActivityIndicator color={Colors.yellow} style={{ marginTop: 40 }} />
        ) : visibleEvents.length === 0 ? (
          (() => {
            const es = EMPTY_STATE[timePeriod];
            return (
              <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
                <Animated.View style={[s.emptyIconBox, { backgroundColor: colors.gray100, transform: [{ scale: breatheAnim }] }]}>
                  <Text style={{ fontSize: 32 }}>{es.emoji}</Text>
                </Animated.View>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>{es.title}</Text>
                <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, textAlign: 'center' }}>{es.sub}</Text>
              </View>
            );
          })()
        ) : visibleEvents.map(e => {
          const stream = streams.find(st => st.claude_key === e.calendar_stream);
          const eventPast = e.date ? isPast(e.date) : false;

          const cardContent = (
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedEvent(e); }}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10, gap: 14, overflow: 'hidden', opacity: eventPast ? 0.45 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] },
                Shadow.card,
              ]}
            >
              {stream?.color && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: stream.color }} />}
              <Text style={{ fontSize: 24, marginLeft: stream?.color ? 8 : 0 }}>{eventEmoji(e.title)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.black }}>{e.title}</Text>
                {(timePeriod === 'thisweek' || timePeriod === 'nextweek') && e.date && (
                  <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400, marginTop: 2 }}>
                    {sectionLabel(e.date)}
                  </Text>
                )}
                {e.time && <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400, marginTop: 2 }}>{e.time}</Text>}
              </View>
              {stream && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: stream.color + '22' }}>
                  <Text style={{ fontSize: 11, color: stream.color, fontFamily: 'Inter_600SemiBold' }}>{stream.emoji}</Text>
                </View>
              )}
            </Pressable>
          );

          return (
            <Swipeable
              key={e.id}
              renderRightActions={() => (
                <View style={{ width: 72, justifyContent: 'center', alignItems: 'center', marginBottom: 10 }}>
                  <View style={{ backgroundColor: '#E74C3C', borderRadius: Radius.lg, width: 56, height: '100%', justifyContent: 'center', alignItems: 'center' }}>
                    <Ionicons name="trash-outline" size={20} color="#fff" />
                  </View>
                </View>
              )}
              onSwipeableOpen={() => setDeleteTarget(e)}
            >
              {cardContent}
            </Swipeable>
          );
        })}
      </Animated.ScrollView>

      {/* QuickAdd FAB */}
      <TouchableOpacity
        onPress={() => openQuickAdd()}
        style={{ position: 'absolute', right: 20, bottom: TAB_BAR_CLEARANCE - 20, width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.yellow, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={26} color={Colors.black} />
      </TouchableOpacity>

      </> /* end list view */}

      {/* ── Calendar: month grid ─────────────────────────────────────── */}
      {viewMode === 'calendar' && !dayDetailMode && (
        <FlatList
          ref={monthsRef}
          data={months}
          style={{ flex: 1, backgroundColor: colors.offWhite }}
          keyExtractor={m => `${m.year}-${m.month}`}
          initialScrollIndex={MONTHS_BEFORE}
          getItemLayout={(_, index) => ({ length: MONTH_H, offset: MONTH_H * index, index })}
          onScrollToIndexFailed={() => {}}
          showsVerticalScrollIndicator={false}
          extraData={selectedDate}
          renderItem={({ item: m }) => (
            <MonthGrid
              year={m.year} month={m.month}
              eventsByDate={eventsByDate} streams={streams} selectedDate={selectedDate}
              weekStart={settings.week_start}
              onDayPress={(d) => {
                setSelectedDate(d);
                setDayDetailMode(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            />
          )}
        />
      )}

      {/* ── Calendar: day detail (timeline) ─────────────────────────── */}
      {viewMode === 'calendar' && dayDetailMode && (
        <View style={{ flex: 1, backgroundColor: colors.offWhite }} {...daySwipePanResponder.panHandlers}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
            <TouchableOpacity onPress={() => setDayDetailMode(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, width: 70 }} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={colors.black} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.black }}>Terug</Text>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.black, flex: 1, textAlign: 'center' }}>{sectionLabel(selectedDate)}</Text>
            <TouchableOpacity onPress={() => openQuickAdd(selectedDate)} style={{ width: 70, alignItems: 'flex-end' }}>
              <Ionicons name="add-circle-outline" size={24} color={Colors.yellow} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }} showsVerticalScrollIndicator={false}>
            {/* All-day events */}
            {selectedDayEvents.filter(e => !e.time).length > 0 && (
              <View style={{ backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100, padding: 10, paddingHorizontal: 14 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Hele dag</Text>
                {selectedDayEvents.filter(e => !e.time).map(e => {
                  const color = getEventColor(e, streams);
                  return (
                    <TouchableOpacity key={e.id} onPress={() => openEditEvent(e)} onLongPress={() => setDeleteTarget(e)} activeOpacity={0.8}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color + '22', borderLeftWidth: 3, borderLeftColor: color, borderRadius: 6, padding: 10, marginBottom: 4 }}>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.black, flex: 1 }}>{e.title}</Text>
                      {e.source === 'phone' && <Text style={{ fontSize: 10, color: colors.gray400 }}>iPhone</Text>}
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}

            {/* Hour timeline */}
            <View style={{ position: 'relative', paddingTop: 4 }}>
              {Array.from({ length: 18 }, (_, i) => i + 6).map(h => (
                <View key={h} style={{ height: 60, flexDirection: 'row' }}>
                  <View style={{ width: 52, paddingRight: 10, alignItems: 'flex-end', justifyContent: 'flex-start' }}>
                    <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: colors.gray400, marginTop: -7 }}>
                      {String(h).padStart(2, '0')}:00
                    </Text>
                  </View>
                  <View style={{ flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.gray100 }} />
                </View>
              ))}

              {/* Current time indicator */}
              {selectedDate === TODAY && (() => {
                const now = new Date();
                const top = 4 + (now.getHours() - 6 + now.getMinutes() / 60) * 60;
                if (top < 4 || top > 4 + 17 * 60) return null;
                return (
                  <View style={{ position: 'absolute', left: 46, right: 0, top, flexDirection: 'row', alignItems: 'center', zIndex: 2, pointerEvents: 'none' }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.yellow, marginLeft: -4 }} />
                    <View style={{ flex: 1, height: 1.5, backgroundColor: Colors.yellow }} />
                  </View>
                );
              })()}

              {/* Timed event blocks — tap=edit, long-press drag=reschedule */}
              {selectedDayEvents.filter(e => e.time).map(e => {
                const { h, m } = parseTime(e.time!);
                const baseTop = 4 + (h - 6 + m / 60) * 60;
                const color = getEventColor(e, streams);
                const isDragging = dragEvent?.id === e.id;
                const displayTop = isDragging ? Math.max(4, dragY) : Math.max(4, baseTop);
                const dragH = Math.round((displayTop - 4) / 60) + 6;
                const dragMin = Math.round(((displayTop - 4) / 60 - (dragH - 6)) * 60 / 15) * 15;
                const dragTimeLabel = `${String(dragH).padStart(2,'0')}:${String(Math.min(dragMin,59)).padStart(2,'0')}`;

                const panResponder = PanResponder.create({
                  onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
                  onPanResponderGrant: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDragEvent(e); setDragY(baseTop); },
                  onPanResponderMove: (_, g) => { setDragY(Math.max(4, baseTop + g.dy)); },
                  onPanResponderRelease: async (_, g) => {
                    const newTop = Math.max(4, baseTop + g.dy);
                    const nh = Math.round((newTop - 4) / 60) + 6;
                    const nm = Math.round(((newTop - 4) / 60 - (nh - 6)) * 60 / 15) * 15;
                    const newTime = `${String(Math.min(nh,23)).padStart(2,'0')}:${String(Math.min(nm,59)).padStart(2,'0')}`;
                    if (e.source === 'sous-chef') {
                      await supabase.from('events').update({ time: newTime }).eq('id', e.id);
                    }
                    setAllEvents(prev => prev.map(ev => ev.id === e.id ? { ...ev, time: newTime } : ev));
                    setDragEvent(null);
                  },
                  onPanResponderTerminate: () => setDragEvent(null),
                });

                return (
                  <Animated.View key={e.id} {...panResponder.panHandlers}
                    style={{ position: 'absolute', left: 58, right: 8, top: displayTop, height: 56, backgroundColor: color + (isDragging ? 'FF' : 'D0'), borderRadius: 8, borderLeftWidth: 3, borderLeftColor: color, padding: 8, zIndex: isDragging ? 10 : 1, shadowColor: '#000', shadowOpacity: isDragging ? 0.3 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: isDragging ? 8 : 0 }}>
                    <TouchableOpacity onPress={() => !isDragging && openEditEvent(e)} onLongPress={() => setDeleteTarget(e)} activeOpacity={0.85} style={{ flex: 1 }}>
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#fff' }} numberOfLines={1}>{e.title}</Text>
                      <Text style={{ fontFamily: 'Inter_300Light', fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
                        {isDragging ? dragTimeLabel : e.time}{e.source === 'phone' ? ' · iPhone' : ''}
                      </Text>
                    </TouchableOpacity>
                  </Animated.View>
                );
              })}
            </View>

            {selectedDayEvents.length === 0 && (
              <View style={{ alignItems: 'center', paddingTop: 40, gap: 12 }}>
                <View style={[s.emptyIconBox, { backgroundColor: colors.gray100 }]}>
                  <Text style={{ fontSize: 32 }}>📅</Text>
                </View>
                <Text style={[s.emptyTitle, { color: colors.black }]}>Geen afspraken</Text>
              </View>
            )}
          </ScrollView>
        </View>
      )}

      {/* Event detail modal */}
      <Modal visible={!!selectedEvent} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setSelectedEvent(null)}>
        {selectedEvent && (
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
              <TouchableOpacity onPress={() => setSelectedEvent(null)} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.gray100, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="close" size={18} color={colors.black} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.black }}>Afspraak</Text>
              <View style={{ width: 34 }} />
            </View>
            <ScrollView contentContainerStyle={{ padding: 28, gap: 16 }}>
              <Text style={{ fontFamily: 'TitanOne_400Regular', fontSize: 28, color: colors.black, letterSpacing: 0.5 }}>{selectedEvent.title}</Text>
              {selectedEvent.date && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="calendar-outline" size={18} color={colors.gray400} />
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.black }}>{sectionLabel(selectedEvent.date)}</Text>
                </View>
              )}
              {selectedEvent.time && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="time-outline" size={18} color={colors.gray400} />
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.black }}>{selectedEvent.time}</Text>
                </View>
              )}
              {selectedEvent.source === 'phone' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="phone-portrait-outline" size={18} color={colors.gray400} />
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray400 }}>iPhone-agenda</Text>
                </View>
              )}
              {(() => {
                const stream = streams.find(st => st.claude_key === selectedEvent.calendar_stream);
                if (!stream) return null;
                return (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: stream.color }} />
                    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: stream.color }}>{stream.emoji} {stream.name}</Text>
                  </View>
                );
              })()}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      {/* Delete confirmation bottom sheet */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black, marginBottom: 8 }}>Afspraak verwijderen?</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray400, marginBottom: 24 }}>
              "{deleteTarget?.title}" wordt permanent verwijderd.
            </Text>
            <Pressable
              onPress={() => { if (deleteTarget) deleteEvent(deleteTarget); }}
              style={({ pressed }) => [{ backgroundColor: '#E74C3C', borderRadius: Radius.pill, paddingVertical: 14, alignItems: 'center', marginBottom: 10, opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff' }}>Verwijderen</Text>
            </Pressable>
            <Pressable
              onPress={() => setDeleteTarget(null)}
              style={({ pressed }) => [{ backgroundColor: colors.gray100, borderRadius: Radius.pill, paddingVertical: 14, alignItems: 'center', opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.black }}>Annuleren</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* QuickAdd modal */}
      <Modal visible={quickAddVisible} transparent animationType="slide" onRequestClose={() => setQuickAddVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setQuickAddVisible(false)}>
            <Pressable style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 32, gap: 14 }} onPress={() => {}}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.gray200, alignSelf: 'center', marginBottom: 4 }} />
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Nieuwe afspraak</Text>
              <View style={{ backgroundColor: colors.gray100, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 4 }}>
                <TextInputRN
                  style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.black, paddingVertical: 12 }}
                  value={quickAddTitle}
                  onChangeText={setQuickAddTitle}
                  placeholder="Wat is de afspraak?"
                  placeholderTextColor={colors.gray400}
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={saveQuickEvent}
                  selectionColor={Colors.yellow}
                />
              </View>
              {/* Date row */}
              <TouchableOpacity onPress={() => { setShowDatePicker(v => !v); setShowTimePicker(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray100, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
                <Ionicons name="calendar-outline" size={18} color={Colors.yellow} />
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.black, flex: 1 }}>
                  {quickAddDate.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short' })}
                </Text>
                <Ionicons name={showDatePicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker value={quickAddDate} mode="date" display="inline" locale="nl-NL" accentColor={Colors.yellow}
                  onChange={(_, d) => { if (d) setQuickAddDate(d); }} minimumDate={new Date()} style={{ alignSelf: 'center' }} />
              )}
              {/* Time row */}
              <TouchableOpacity onPress={() => { setShowTimePicker(v => !v); setShowDatePicker(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray100, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}>
                <Ionicons name="time-outline" size={18} color={quickAddTime ? Colors.yellow : colors.gray400} />
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: quickAddTime ? colors.black : colors.gray400, flex: 1 }}>
                  {quickAddTime
                    ? `${String(quickAddTime.getHours()).padStart(2,'0')}:${String(quickAddTime.getMinutes()).padStart(2,'0')}`
                    : 'Tijd — optioneel'}
                </Text>
                {quickAddTime
                  ? <TouchableOpacity onPress={(e) => { e.stopPropagation(); setQuickAddTime(null); setShowTimePicker(false); }}><Ionicons name="close-circle" size={18} color={colors.gray400} /></TouchableOpacity>
                  : <Ionicons name={showTimePicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
                }
              </TouchableOpacity>
              {showTimePicker && (
                <DateTimePicker value={quickAddTime ?? new Date()} mode="time" display="spinner" locale="nl-NL" is24Hour
                  onChange={(_, t) => { if (t) { setQuickAddTime(t); setShowTimePicker(false); } }} />
              )}
              <TouchableOpacity onPress={saveQuickEvent} disabled={!quickAddTitle.trim() || quickAddSaving}
                style={{ backgroundColor: Colors.yellow, borderRadius: Radius.pill, paddingVertical: 16, alignItems: 'center', opacity: quickAddTitle.trim() ? 1 : 0.4 }}>
                {quickAddSaving
                  ? <ActivityIndicator size="small" color={Colors.black} />
                  : <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black }}>Opslaan</Text>}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Edit event modal */}
      <Modal visible={!!editEvent} transparent animationType="slide" onRequestClose={() => setEditEvent(null)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setEditEvent(null)}>
            <Pressable style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 32, gap: 14 }} onPress={() => {}}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.gray200, alignSelf: 'center', marginBottom: 4 }} />
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Afspraak bewerken</Text>
              {editEvent?.source === 'phone' && (
                <View style={{ backgroundColor: colors.gray100, borderRadius: Radius.md, padding: 12, flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                  <Ionicons name="information-circle-outline" size={16} color={colors.gray400} />
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.gray400, flex: 1 }}>iPhone-agenda items kunnen niet worden bewerkt vanuit Sous-Chef.</Text>
                </View>
              )}
              <View style={{ backgroundColor: colors.gray100, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 4, opacity: editEvent?.source === 'phone' ? 0.5 : 1 }}>
                <TextInputRN
                  style={{ fontFamily: 'Inter_400Regular', fontSize: 16, color: colors.black, paddingVertical: 12 }}
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="Naam afspraak"
                  placeholderTextColor={colors.gray400}
                  editable={editEvent?.source !== 'phone'}
                  selectionColor={Colors.yellow}
                />
              </View>
              <TouchableOpacity onPress={() => { setEditShowDatePicker(v => !v); setEditShowTimePicker(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray100, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, gap: 10, opacity: editEvent?.source === 'phone' ? 0.5 : 1 }}>
                <Ionicons name="calendar-outline" size={18} color={Colors.yellow} />
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.black, flex: 1 }}>
                  {editDate.toLocaleDateString('nl-NL', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                <Ionicons name={editShowDatePicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
              </TouchableOpacity>
              {editShowDatePicker && editEvent?.source !== 'phone' && (
                <DateTimePicker value={editDate} mode="date" display="inline" locale="nl-NL" accentColor={Colors.yellow}
                  onChange={(_, d) => { if (d) setEditDate(d); }} style={{ alignSelf: 'center' }} />
              )}
              <TouchableOpacity onPress={() => { setEditShowTimePicker(v => !v); setEditShowDatePicker(false); }}
                style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.gray100, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, gap: 10, opacity: editEvent?.source === 'phone' ? 0.5 : 1 }}>
                <Ionicons name="time-outline" size={18} color={editTime ? Colors.yellow : colors.gray400} />
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: editTime ? colors.black : colors.gray400, flex: 1 }}>
                  {editTime
                    ? `${String(editTime.getHours()).padStart(2,'0')}:${String(editTime.getMinutes()).padStart(2,'0')}`
                    : 'Geen tijdstip'}
                </Text>
                {editTime
                  ? <TouchableOpacity onPress={(e) => { e.stopPropagation(); setEditTime(null); setEditShowTimePicker(false); }}><Ionicons name="close-circle" size={18} color={colors.gray400} /></TouchableOpacity>
                  : <Ionicons name={editShowTimePicker ? 'chevron-up' : 'chevron-down'} size={16} color={colors.gray400} />
                }
              </TouchableOpacity>
              {editShowTimePicker && editEvent?.source !== 'phone' && (
                <DateTimePicker value={editTime ?? new Date()} mode="time" display="spinner" locale="nl-NL" is24Hour
                  onChange={(_, t) => { if (t) { setEditTime(t); setEditShowTimePicker(false); } }} />
              )}
              {editEvent?.source === 'sous-chef' && (
                <TouchableOpacity onPress={saveEditEvent} disabled={!editTitle.trim() || editSaving}
                  style={{ backgroundColor: Colors.yellow, borderRadius: Radius.pill, paddingVertical: 16, alignItems: 'center', opacity: editTitle.trim() ? 1 : 0.4 }}>
                  {editSaving
                    ? <ActivityIndicator size="small" color={Colors.black} />
                    : <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black }}>Opslaan</Text>}
                </TouchableOpacity>
              )}
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      {/* Bottom fade */}
      <LinearGradient
        colors={[`${colors.offWhite}00`, colors.offWhite]}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, pointerEvents: 'none' }}
      />
    </View>
  );
}

export default function AgendaTab() {
  return <AgendaLite />;
}


// ── Styles ─────────────────────────────────────────────────────────────────────

const cal = StyleSheet.create({
  monthBlock:  { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  monthLabel:  { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.black, marginBottom: 12 },
  weekRow:     { flexDirection: 'row', marginBottom: 4 },
  weekDay:     { flex: 1, textAlign: 'center', fontFamily: 'Inter_400Regular', fontSize: 11, color: Colors.gray400 },
  grid:        { flexDirection: 'row', flexWrap: 'wrap' },
  cell:        { width: `${100 / 7}%` as any, alignItems: 'center', paddingVertical: 3 },
  circle:      { width: 34, height: 34, borderRadius: 17, justifyContent: 'center', alignItems: 'center' },
  circleToday: { backgroundColor: Colors.yellow },
  circleSelected: { backgroundColor: Colors.black },
  num:         { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.black },
  numToday:    { fontFamily: 'Inter_700Bold', color: Colors.black },
  numSelected: { color: Colors.white },
  numPast:     { color: Colors.gray200 },
  dot:         { width: 6, height: 6, borderRadius: 3, marginTop: 3 },
  dotEmpty:    { width: 6, height: 6, marginTop: 3 },
  dotFuture:   { backgroundColor: Colors.yellow },
  dotPast:     { backgroundColor: Colors.gray200 },
  dotSelected: { backgroundColor: Colors.white },
  dotToday:    { backgroundColor: Colors.black },
  noEvents:    { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400 },
  eventRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.gray100 },
  eventEmoji:  { fontSize: 20, marginRight: 12 },
  eventTitle:  { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: Colors.black },
  eventSub:    { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.gray400, marginTop: 1 },
  dayDetailHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1,
  },
  dayDetailBack: { flexDirection: 'row', alignItems: 'center', gap: 2, width: 70 },
  dayDetailBackText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  dayDetailTitle: { fontFamily: 'Inter_700Bold', fontSize: 17, textAlign: 'center', flex: 1 },
  dayEventCard: {
    flexDirection: 'row', alignItems: 'center', borderRadius: Radius.lg,
    padding: 16, marginBottom: 10,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.offWhite },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  banner:      { paddingHorizontal: 28, paddingBottom: 32, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden', marginBottom: 4 },
  bannerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 34, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase' },
  bannerStats: { flexDirection: 'row', gap: 10 },
  statTile: { paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#FFFFFF0F', borderRadius: 16, borderWidth: 1, borderColor: '#FFFFFF16', minWidth: 96 },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum: { fontFamily: 'Inter_700Bold', fontSize: 24, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },
  icalBtn:     { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFFFFF12', borderRadius: Radius.pill, borderWidth: 1, borderColor: '#FFFFFF20' },
  icalBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.yellow },

  filterRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  pill:           { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 24, backgroundColor: '#E4E4E4' },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, backgroundColor: '#E4E4E4' },
  pillActive:     { backgroundColor: Colors.yellow },
  pillText:       { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#222' },
  pillTextActive: { color: '#111' },
  unlinkBtn: { padding: 7 },

  toggleWrap: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 6, paddingBottom: 14, gap: 24 },
  tabTextBtn: { alignItems: 'center', paddingBottom: 8 },
  tabTextLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.3 },
  tabTextUnderline: { height: 3, width: '100%', borderRadius: 2, marginTop: 5 },

  permBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.yellowLight, marginHorizontal: 16, marginBottom: 8, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  permText:   { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.black },
  pastToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginBottom: 4 },
  pastToggleText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.gray400 },

  sectionHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 10, backgroundColor: Colors.offWhite },
  sectionHeaderPast: { opacity: 0.5 },
  dot:               { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gray200 },
  dotToday:          { backgroundColor: Colors.yellow, width: 8, height: 8, borderRadius: 4 },
  sectionLabel:      { fontFamily: 'Inter_600SemiBold', fontSize: 11, color: Colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionLabelToday: { color: Colors.yellow },
  sectionLabelPast:  { color: Colors.gray400 },

  cardWrap: { paddingHorizontal: 16, paddingBottom: 10 },
  card:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.card },
  cardPast: { opacity: 0.5 },
  accent:        { width: 4, alignSelf: 'stretch' },
  accentDefault: { backgroundColor: Colors.gray200 },
  accentToday:   { backgroundColor: Colors.yellow },
  accentPhone:   { backgroundColor: Colors.gray200 },
  emoji:     { fontSize: 22, marginHorizontal: 16 },
  cardBody:  { flex: 1, paddingVertical: 16, paddingRight: 8 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.black, marginBottom: 5 },
  muted:     { color: Colors.gray400 },
  metaRow:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag:       { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.gray100, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  tagText:   { fontFamily: 'Inter_400Regular', fontSize: 10, color: Colors.gray600 },
  countLabel:{ fontFamily: 'Inter_300Light', fontSize: 12, color: Colors.gray400, paddingRight: 14 },

  empty:      { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyIconBox: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: Colors.black },
  emptyText:  { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400, textAlign: 'center' },

  todayBtn: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: 'center',
    backgroundColor: Colors.yellow,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
    zIndex: 99,
  },
  todayBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: Colors.black },
});
