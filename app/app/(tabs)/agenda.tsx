import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react';
import { useNavigation } from 'expo-router';
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
  LayoutAnimation,
  Dimensions,
  TextInput as TextInputRN,
  KeyboardAvoidingView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Calendar from 'expo-calendar';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { CalEvent } from '@/lib/types';
import { Colors, Radius, Shadow, ThemeColors, TAB_BAR_CLEARANCE, getTone, TONE_ORDER } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCache, setCache } from '@/lib/cache';

type CalendarStream = { id: string; claude_key: string; color: string; name: string; emoji: string };

type MergedEvent = {
  id: string; title: string; date: string | null; time?: string | null;
  endDate?: string | null;
  recurrence?: string | null; reminder_days_before?: number;
  calendar_stream?: string | null;
  source: 'sous-chef' | 'phone';
};
type Section  = { dateKey: string; label: string; isToday: boolean; isPast: boolean; data: MergedEvent[] };
type FlatItem = { type: 'header'; section: Section } | { type: 'item'; item: MergedEvent; section: Section; isLast: boolean };
type ViewMode   = 'list' | 'week' | 'calendar';
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
  if (event.source === 'phone') return '#5F5380'; // lav tone
  const stream = streams.find(s => s.claude_key === event.calendar_stream);
  return stream?.color ?? '#46607A'; // sky tone as fallback
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

function MonthGrid({ year, month, eventsByDate, selectedDate, onDayPress, streams, weekStart, allEvents }: {
  year: number; month: number; eventsByDate: Map<string, MergedEvent[]>;
  selectedDate: string; onDayPress: (k: string) => void; streams: CalendarStream[];
  weekStart: 'monday' | 'sunday';
  allEvents: MergedEvent[];
}) {
  const { colors } = useTheme();
  const firstDow    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const leadingBlanks = weekStart === 'monday'
    ? (firstDow === 0 ? 6 : firstDow - 1)
    : firstDow;

  const DAY_HEADERS = weekStart === 'monday'
    ? ['Ma','Di','Wo','Do','Vr','Za','Zo']
    : ['Zo','Ma','Di','Wo','Do','Vr','Za'];
  const WEEKEND_INDICES = weekStart === 'monday' ? [5, 6] : [0, 6];

  const allDays: (null | { key: string; num: number; isToday: boolean; isWeekend: boolean })[] = [];
  for (let b = 0; b < leadingBlanks; b++) allDays.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toKey(new Date(year, month, d));
    const dow = new Date(year, month, d).getDay();
    const colIndex = weekStart === 'monday' ? (dow === 0 ? 6 : dow - 1) : dow;
    allDays.push({ key, num: d, isToday: key === TODAY, isWeekend: WEEKEND_INDICES.includes(colIndex) });
  }
  while (allDays.length % 7 !== 0) allDays.push(null);

  const weeks: typeof allDays[] = [];
  for (let i = 0; i < allDays.length; i += 7) weeks.push(allDays.slice(i, i + 7));

  const label = new Date(year, month, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

  const firstKey = toKey(new Date(year, month, 1));
  const lastKey  = toKey(new Date(year, month + 1, 0));
  const allMultiDay = allEvents.filter(e =>
    e.date && e.endDate && e.endDate > e.date &&
    e.date <= lastKey && e.endDate >= firstKey
  );

  return (
    <View style={{ backgroundColor: colors.white, marginBottom: 1 }}>
      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.black, paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 }}>
        {label[0].toUpperCase() + label.slice(1)}
      </Text>
      <View style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
        {DAY_HEADERS.map((n, i) => (
          <Text key={n} style={{ flex: 1, textAlign: 'center', fontFamily: 'Inter_600SemiBold', fontSize: 11, color: WEEKEND_INDICES.includes(i) ? colors.gray200 : colors.gray400, paddingBottom: 6 }}>{n}</Text>
        ))}
      </View>
      {weeks.map((week, wi) => {
        const weekActual = week.filter((d): d is NonNullable<typeof d> => d !== null);
        const weekStartKey = weekActual[0]?.key;
        const weekEndKey   = weekActual[weekActual.length - 1]?.key;
        const weekMultiDay = weekStartKey && weekEndKey
          ? allMultiDay.filter(e => e.date! <= weekEndKey && e.endDate! >= weekStartKey)
          : [];
        const maxChips = weekMultiDay.length >= 2 ? 0 : weekMultiDay.length === 1 ? 1 : 2;

        return (
          <View key={wi} style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100, minHeight: 76 }}>
            {/* Day number circles */}
            <View style={{ flexDirection: 'row' }}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={{ flex: 1, height: 35, backgroundColor: 'transparent' }} />;
                const isSelected = selectedDate === day.key;
                const isPastDay  = day.key < TODAY;
                return (
                  <TouchableOpacity key={day.key} style={{ flex: 1, paddingTop: 6, paddingBottom: 3, alignItems: 'center', backgroundColor: day.isWeekend ? colors.offWhite : 'transparent' }} onPress={() => onDayPress(day.key)} activeOpacity={0.7}>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: day.isToday ? Colors.yellow : isSelected ? colors.black : 'transparent', justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{
                        fontFamily: (day.isToday || isSelected) ? 'Inter_700Bold' : 'Inter_400Regular',
                        fontSize: 13,
                        color: day.isToday ? Colors.black : isSelected ? Colors.white : isPastDay ? colors.gray200 : day.isWeekend ? colors.gray400 : colors.black,
                      }}>{day.num}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Multi-day event spanning bars */}
            {weekMultiDay.slice(0, 2).map(e => {
              const color = getEventColor(e, streams);
              return (
                <View key={e.id} style={{ flexDirection: 'row', height: 14, marginBottom: 2, marginHorizontal: 1 }}>
                  {week.map((day, di) => {
                    if (!day || !e.date || !e.endDate) return <View key={di} style={{ flex: 1 }} />;
                    const inRange = day.key >= e.date && day.key <= e.endDate;
                    if (!inRange) return <View key={di} style={{ flex: 1 }} />;
                    const isStartDay = day.key === e.date;
                    const isEndDay   = day.key === e.endDate;
                    return (
                      <TouchableOpacity key={di} style={{ flex: 1, height: 14, backgroundColor: color + '25', borderTopLeftRadius: isStartDay ? 3 : 0, borderBottomLeftRadius: isStartDay ? 3 : 0, borderTopRightRadius: isEndDay ? 3 : 0, borderBottomRightRadius: isEndDay ? 3 : 0, borderLeftWidth: isStartDay ? 2 : 0, borderLeftColor: color, justifyContent: 'center', overflow: 'hidden', paddingLeft: isStartDay ? 3 : 0 }} onPress={() => onDayPress(day.key)} activeOpacity={0.7}>
                        {isStartDay && <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', fontSize: 8, color, lineHeight: 12 }}>{e.title}</Text>}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
            {weekMultiDay.length > 2 && (
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color: colors.gray400, paddingLeft: 5, marginBottom: 2 }}>+{weekMultiDay.length - 2} meer</Text>
            )}

            {/* Single-day event chips per day */}
            <View style={{ flexDirection: 'row', paddingBottom: 4 }}>
              {week.map((day, di) => {
                if (!day) return <View key={di} style={{ flex: 1 }} />;
                const singleEvents = (eventsByDate.get(day.key) ?? []).filter(e => !e.endDate || e.endDate <= e.date!);
                return (
                  <TouchableOpacity key={day.key} style={{ flex: 1, paddingHorizontal: 1, backgroundColor: day.isWeekend ? colors.offWhite : 'transparent' }} onPress={() => onDayPress(day.key)} activeOpacity={0.7}>
                    {singleEvents.slice(0, maxChips).map(e => {
                      const color = getEventColor(e, streams);
                      const shortTitle = e.title.length > 13 ? e.title.slice(0, 12) + '…' : e.title;
                      return (
                        <View key={e.id} style={{ backgroundColor: color + '20', borderRadius: 4, borderLeftWidth: 2, borderLeftColor: color, paddingHorizontal: 3, paddingVertical: 2, marginBottom: 2 }}>
                          <Text numberOfLines={1} style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color, lineHeight: 12 }}>{shortTitle}</Text>
                        </View>
                      );
                    })}
                    {singleEvents.length > maxChips && (
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color: Colors.yellow, paddingHorizontal: 3 }}>+{singleEvents.length - maxChips}</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Calm tone-based stream colors (fg colors from Rustig palette)
const DEFAULT_STREAMS: CalendarStream[] = [
  { id: '__persoonlijk', claude_key: 'persoonlijk', color: '#46607A', name: 'Persoonlijk', emoji: '👤' },
  { id: '__werk',        claude_key: 'werk',        color: '#8E5F3D', name: 'Werk',        emoji: '💼' },
  { id: '__familie',     claude_key: 'familie',     color: '#5C7351', name: 'Familie',     emoji: '👨‍👩‍👧' },
  { id: '__gezondheid',  claude_key: 'gezondheid',  color: '#8E5151', name: 'Gezondheid',  emoji: '🏥' },
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
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const liteScrollRef                     = useRef<ScrollView>(null);
  const chipScrollRef                     = useRef<ScrollView>(null);
  const breatheAnim                       = useRef(new Animated.Value(1)).current;
  const scrollYAnim                       = useRef(new Animated.Value(0)).current;

  const [showStreamFilter, setShowStreamFilter] = useState(false);

  const [quickAddVisible, setQuickAddVisible] = useState(false);
  const [quickAddTitle, setQuickAddTitle]     = useState('');
  const [quickAddDate, setQuickAddDate]       = useState<Date>(new Date());
  const [quickAddTime, setQuickAddTime]       = useState<Date | null>(null);
  const [quickAddStream, setQuickAddStream]   = useState<string | null>(null);
  const [quickAddSaving, setQuickAddSaving]   = useState(false);
  const [showDatePicker, setShowDatePicker]   = useState(false);
  const [showTimePicker, setShowTimePicker]   = useState(false);

  const [editEvent, setEditEvent]             = useState<MergedEvent | null>(null);
  const [editTitle, setEditTitle]             = useState('');
  const [editDate, setEditDate]               = useState<Date>(new Date());
  const [editTime, setEditTime]               = useState<Date | null>(null);
  const [editStream, setEditStream]           = useState<string | null>(null);
  const [editShowDatePicker, setEditShowDatePicker] = useState(false);
  const [editShowTimePicker, setEditShowTimePicker] = useState(false);
  const [editSaving, setEditSaving]           = useState(false);

  const [detailStream, setDetailStream]       = useState<string | null>(null);
  const [detailSaving, setDetailSaving]       = useState(false);

  // drag state for timeline
  const [dragEvent, setDragEvent]             = useState<MergedEvent | null>(null);
  const [dragY, setDragY]                     = useState(0);
  const dragTimeRef                           = useRef<string | null>(null);

  const [viewMode, setViewMode]           = useState<'list' | 'week' | 'calendar'>('list');
  const [weekOffset, setWeekOffset]       = useState(0);
  const [weekFocusDay, setWeekFocusDay]   = useState<string | null>(null);
  const [selectedDate, setSelectedDate]   = useState(TODAY);
  const dayDetailScrollRef                = useRef<ScrollView>(null);

  useEffect(() => {
    AsyncStorage.getItem('agenda_view_mode').then(v => {
      if (v === 'list' || v === 'week' || v === 'calendar') setViewMode(v);
    });
  }, []);
  const [dayDetailMode, setDayDetailMode] = useState(false);
  const monthsRef = useRef<FlatList>(null);
  const monthOffsetsRef = useRef<number[]>([]);
  const { settings } = useModuleSettings();

  // Reset to today whenever the agenda tab gains focus
  const navigation = useNavigation();
  useEffect(() => {
    const unsub = navigation.addListener('focus' as any, () => {
      const today = new Date().toISOString().split('T')[0];
      setSelectedDate(today);
      setTimePeriod('today');
      setStreamFilter(null);
      setDayDetailMode(false);
      setTimeout(() => {
        liteScrollRef.current?.scrollTo({ y: 0, animated: false });
        chipScrollRef.current?.scrollTo({ x: 0, animated: false });
        monthsRef.current?.scrollToOffset({ offset: monthOffsetsRef.current[MONTHS_BEFORE] ?? 0, animated: false });
      }, 80);
    });
    return unsub;
  }, [navigation]);

  // Center on current month whenever calendar grid becomes visible
  useEffect(() => {
    if (viewMode === 'calendar' && !dayDetailMode) {
      setTimeout(() => monthsRef.current?.scrollToOffset({ offset: monthOffsetsRef.current[MONTHS_BEFORE] ?? 0, animated: false }), 60);
    }
  }, [viewMode, dayDetailMode]);

  // Scroll day detail to current hour when opening
  useEffect(() => {
    if (viewMode === 'calendar' && dayDetailMode) {
      const now = new Date();
      const y = Math.max(0, 4 + (now.getHours() - 6) * 60 - 120);
      setTimeout(() => dayDetailScrollRef.current?.scrollTo({ y, animated: false }), 80);
    }
  }, [viewMode, dayDetailMode, selectedDate]);

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
    getCache<{ events: MergedEvent[]; streams: CalendarStream[] }>('cache_events').then(d => {
      if (d) { setAllEvents(d.events); setStreams(d.streams); setLoading(false); }
    });
  }, []);

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
      const streamsData = streamRes.data ?? [];
      if (streamRes.data) setStreams(streamRes.data);

      if (Platform.OS !== 'web') {
        Calendar.getCalendarPermissionsAsync().then(({ status }) => {
          if (status !== 'granted') {
            setAllEvents(scEvents);
            setCache('cache_events', { events: scEvents, streams: streamsData });
            setLoading(false);
            return;
          }
          Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT).then(cals => {
            const start2 = new Date(now); start2.setHours(0, 0, 0, 0);
            const end2   = new Date(now); end2.setFullYear(end2.getFullYear() + 1);
            Calendar.getEventsAsync(cals.map(c => c.id), start2, end2).then(phoneEvts => {
              const scKeys = new Set(scEvents.map(e => `${e.title?.toLowerCase()}|${e.date}`));
              const merged: MergedEvent[] = phoneEvts
                .filter(e => !scKeys.has(`${e.title?.toLowerCase()}|${e.startDate ? new Date(e.startDate).toISOString().split('T')[0] : ''}`))
                .map(e => {
                  const startDate = e.startDate ? new Date(e.startDate) : null;
                  const dateKey   = startDate ? toKey(startDate) : null;
                  let endKey: string | null = null;
                  if (e.endDate && dateKey) {
                    // allDay endDate from iOS is exclusive (next midnight), subtract 1 day
                    const rawEnd = new Date(e.endDate);
                    const adj = e.allDay ? new Date(rawEnd.getTime() - 24 * 60 * 60 * 1000) : rawEnd;
                    const k = toKey(adj);
                    if (k > dateKey) endKey = k;
                  }
                  return {
                    id: `phone-${e.id}`, title: e.title,
                    date: dateKey,
                    endDate: endKey,
                    time: startDate && !e.allDay ? startDate.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' }) : null,
                    source: 'phone' as const,
                  };
                });
              const allEvts = [...scEvents, ...merged];
              setAllEvents(allEvts);
              setCache('cache_events', { events: allEvts, streams: streamsData });
              setLoading(false);
            });
          });
        });
      } else {
        setAllEvents(scEvents);
        setCache('cache_events', { events: scEvents, streams: streamsData });
        setLoading(false);
      }
    });

    // Real-time subscription: reflect WhatsApp-created events instantly
    const channel = supabase
      .channel(`events:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const e = payload.new as CalEvent;
            if (e.date && e.date >= TODAY && e.date <= endKey) {
              setAllEvents(prev => {
                if (prev.some(ev => ev.id === e.id)) return prev;
                return [...prev, { ...e, source: 'sous-chef' as const }];
              });
            }
          } else if (payload.eventType === 'DELETE') {
            setAllEvents(prev => prev.filter(ev => ev.id !== (payload.old as any).id));
          } else if (payload.eventType === 'UPDATE') {
            const e = payload.new as CalEvent;
            setAllEvents(prev => prev.map(ev => ev.id === e.id ? { ...e, source: 'sous-chef' as const } : ev));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
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

  // Accurate per-month scroll offsets (MONTH_H is just an approximation; actual height varies by week count)
  const monthOffsets = useMemo(() => {
    const HEADER_H = 78; // title(54) + day-labels(23) + marginBottom(1)
    const WEEK_H = 76;
    const ws = settings.week_start;
    const offsets: number[] = [0];
    for (const m of months) {
      const firstDow = new Date(m.year, m.month, 1).getDay();
      const daysInMonth = new Date(m.year, m.month + 1, 0).getDate();
      const leading = ws === 'monday' ? (firstDow === 0 ? 6 : firstDow - 1) : firstDow;
      const weeks = Math.ceil((leading + daysInMonth) / 7);
      offsets.push(offsets[offsets.length - 1] + HEADER_H + weeks * WEEK_H);
    }
    monthOffsetsRef.current = offsets;
    return offsets; // length = months.length + 1
  }, [months, settings.week_start]);

  const eventsByDate = useMemo(() => {
    const m = new Map<string, MergedEvent[]>();
    for (const e of allEvents) {
      if (!e.date) continue;
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [allEvents]);
  const selectedDayEvents = useMemo(() => allEvents.filter(e => {
    if (!e.date) return false;
    if (e.date === selectedDate) return true;
    // Multi-day events that span selectedDate but didn't start on it
    return !!(e.endDate && e.date < selectedDate && e.endDate >= selectedDate);
  }), [allEvents, selectedDate]);

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

  function openDetailEvent(e: MergedEvent) {
    setSelectedEvent(e);
    setDetailStream(e.calendar_stream ?? null);
  }

  async function saveDetailStream(newStream: string | null) {
    if (!selectedEvent || selectedEvent.source !== 'sous-chef') return;
    setDetailSaving(true);
    await supabase.from('events').update({ calendar_stream: newStream }).eq('id', selectedEvent.id);
    setAllEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, calendar_stream: newStream } : e));
    setDetailStream(newStream);
    setDetailSaving(false);
  }

  async function deleteEvent(event: MergedEvent) {
    setAllEvents(prev => prev.filter(e => e.id !== event.id));
    setDeletingId(null);
    if (event.source === 'sous-chef') {
      await fetch(`${API_BASE}/events/${event.id}?user_id=${user!.id}`, { method: 'DELETE' }).catch(() => {});
    } else if (event.source === 'phone' && Platform.OS !== 'web') {
      try { await Calendar.deleteEventAsync(event.id.replace('phone-', '')); } catch (_) {}
    }
  }

  function openQuickAdd(prefillDate?: string) {
    const d = prefillDate ? new Date(prefillDate + 'T12:00:00') : new Date();
    setQuickAddTitle('');
    setQuickAddDate(d);
    setQuickAddTime(null);
    setQuickAddStream(null);
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
      calendar_stream: quickAddStream ?? null,
    }).select().single();
    if (data) setAllEvents(prev => [...prev, { ...data, source: 'sous-chef' as const, calendar_stream: quickAddStream }]);
    setQuickAddVisible(false);
    setQuickAddSaving(false);
  }

  function openEditEvent(e: MergedEvent) {
    setEditEvent(e);
    setEditTitle(e.title);
    setEditDate(e.date ? new Date(e.date + 'T12:00:00') : new Date());
    setEditStream(e.calendar_stream ?? null);
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
      await supabase.from('events').update({ title: editTitle.trim(), date: dateStr, time: timeStr, calendar_stream: editStream }).eq('id', editEvent.id);
    }
    setAllEvents(prev => prev.map(e => e.id === editEvent.id ? { ...e, title: editTitle.trim(), date: dateStr, time: timeStr, calendar_stream: editStream } : e));
    setEditEvent(null);
    setEditSaving(false);
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
      {/* ── Clean warm header ── */}
      <View style={[s.header, { paddingTop: insets.top + 14 }]}>
        <View style={s.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={[s.headerGreet, { color: colors.gray400 }]}>
              {(() => { const h = new Date().getHours(); return h < 12 ? 'Goedemorgen' : h < 18 ? 'Goedemiddag' : 'Goedenavond'; })()}
            </Text>
            <Text style={[s.headerTitle, { color: colors.black }]}>Agenda</Text>
          </View>
          {/* Lijst / Week / Maand segmented control */}
          <View style={[s.segControl, { backgroundColor: colors.gray100 }]}>
            {([['list', 'Lijst'], ['week', 'Week'], ['calendar', 'Maand']] as const).map(([mode, label]) => (
              <TouchableOpacity
                key={mode}
                onPress={() => { setViewMode(mode); setDayDetailMode(false); AsyncStorage.setItem('agenda_view_mode', mode); }}
                style={[s.segBtn, viewMode === mode && { backgroundColor: colors.surface, ...Shadow.card }]}
                activeOpacity={0.75}
              >
                <Text style={[s.segBtnText, { color: viewMode === mode ? colors.black : colors.gray400 }]}>{label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      {/* ── List view ──────────────────────────────────────────────────── */}
      {viewMode === 'list' && <>

      {/* ── Period chips ── */}
      <View style={{ flexGrow: 0, flexShrink: 0, paddingTop: 14, paddingBottom: 6, flexDirection: 'row', alignItems: 'center' }}>
        <ScrollView ref={chipScrollRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }} style={{ flex: 1 }}>
          {PERIOD_LABELS.map(([p, label]) => {
            const count = periodCounts[p];
            const active = timePeriod === p;
            return (
              <TouchableOpacity
                key={p}
                onPress={() => selectPeriod(p)}
                style={{ height: 34, paddingHorizontal: 15, borderRadius: Radius.pill, justifyContent: 'center', alignItems: 'center', backgroundColor: active ? colors.black : colors.gray100 }}
                activeOpacity={0.75}
              >
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13.5, color: active ? colors.offWhite : colors.gray400 }}>
                  {label}
                  {count > 0 && <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: active ? colors.surface2 : colors.gray400 }}> ({count})</Text>}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowStreamFilter(v => !v); if (showStreamFilter) setStreamFilter(null); }}
          style={{ marginRight: 14, width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: (showStreamFilter || streamFilter) ? Colors.yellow + '33' : colors.gray100 }}
          activeOpacity={0.75}
        >
          <Ionicons name="options-outline" size={17} color={(showStreamFilter || streamFilter) ? Colors.yellow : colors.gray400} />
        </TouchableOpacity>
      </View>

      {/* ── Period chips + filter toggle ── */}
      {showStreamFilter && (() => {
        const userKeys = new Set(streams.map(s => s.claude_key));
        const mergedStreams = [...streams, ...DEFAULT_STREAMS.filter(d => !userKeys.has(d.claude_key))];
        return (
          <View style={{ flexGrow: 0, flexShrink: 0, paddingBottom: 10 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 18, gap: 8 }}>
              <TouchableOpacity
                onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStreamFilter(null); }}
                style={{ height: 32, paddingHorizontal: 13, borderRadius: Radius.pill, justifyContent: 'center', backgroundColor: streamFilter === null ? colors.black : colors.gray100 }}
                activeOpacity={0.75}
              >
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: streamFilter === null ? colors.offWhite : colors.gray400 }}>Alles</Text>
              </TouchableOpacity>
              {mergedStreams.map(st => {
                const active = streamFilter === st.claude_key;
                return (
                  <TouchableOpacity
                    key={st.id}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setStreamFilter(active ? null : st.claude_key); }}
                    style={{ height: 32, paddingHorizontal: 13, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: active ? st.color + '22' : colors.gray100, borderWidth: active ? 1.5 : 0, borderColor: st.color }}
                    activeOpacity={0.75}
                  >
                    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: active ? st.color : colors.gray400 }}>{st.emoji} {st.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        );
      })()}

      {/* Events */}
      <Animated.ScrollView
        ref={liteScrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: TAB_BAR_CLEARANCE }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollYAnim } } }], { useNativeDriver: true })}
        scrollEventThrottle={16}
        {...swipePanResponder.panHandlers}
      >
        {loading ? (
          <View style={{ paddingHorizontal: 16, paddingTop: 8, gap: 10 }}>
            {[0.9, 0.7, 0.85, 0.6, 0.75].map((w, i) => (
              <View key={i} style={{ borderRadius: Radius.lg, backgroundColor: colors.gray100, height: 72, width: `${w * 100}%` as any, opacity: 1 - i * 0.12 }} />
            ))}
          </View>
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

          const evColor = getEventColor(e, streams);
          const cardContent = (
            <Pressable
              onPress={() => { if (deletingId) { setDeletingId(null); return; } Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openDetailEvent(e); }}
              onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDeletingId(e.id); }}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: Radius.lg, padding: 16, marginBottom: 12, gap: 14, overflow: 'hidden', opacity: eventPast ? 0.45 : 1, transform: [{ scale: pressed ? 0.975 : 1 }] },
                Shadow.card,
              ]}
            >
              <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3.5, backgroundColor: evColor }} />
              <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: evColor + '18', justifyContent: 'center', alignItems: 'center', marginLeft: 6 }}>
                <Text style={{ fontSize: 20 }}>{eventEmoji(e.title)}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15.5, color: colors.black, letterSpacing: -0.2 }}>{e.title}</Text>
                {(timePeriod === 'thisweek' || timePeriod === 'nextweek') && e.date && (
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.gray400, marginTop: 2 }}>
                    {sectionLabel(e.date)}
                  </Text>
                )}
                {e.time && <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.gray400, marginTop: 2 }}>{e.time}</Text>}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                {e.recurrence && (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: colors.gray100, justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11, color: colors.gray400 }}>↺</Text>
                  </View>
                )}
                {e.source === 'sous-chef' && (
                  <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.yellow + '33', justifyContent: 'center', alignItems: 'center' }}>
                    <Text style={{ fontSize: 11 }}>👨‍🍳</Text>
                  </View>
                )}
                {stream && (
                  <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: stream.color + '22' }}>
                    <Text style={{ fontSize: 11, color: stream.color, fontFamily: 'Inter_600SemiBold' }}>{stream.emoji}</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );

          return (
            <View key={e.id} style={{ position: 'relative' }}>
              {cardContent}
              {deletingId === e.id && (
                <TouchableOpacity
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 12, backgroundColor: '#EF4444', borderRadius: Radius.lg, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }}
                  onPress={() => deleteEvent(e)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="trash-outline" size={18} color="#fff" />
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>Verwijder</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </Animated.ScrollView>

      {/* QuickAdd FAB */}
      <TouchableOpacity
        onPress={() => openQuickAdd()}
        style={{ position: 'absolute', right: 20, bottom: insets.bottom + 90, width: 56, height: 56, borderRadius: 28, overflow: 'hidden', shadowColor: '#FCC10C', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}
        activeOpacity={0.85}
      >
        <LinearGradient colors={['#FCC10C', '#E5A800']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Ionicons name="add" size={26} color={Colors.black} />
        </LinearGradient>
      </TouchableOpacity>

      </> /* end list view */}

      {/* ── Week view ────────────────────────────────────────────────── */}
      {viewMode === 'week' && (() => {
        const now = new Date(); now.setHours(0, 0, 0, 0);
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + weekOffset * 7);

        const weekDays = Array.from({ length: 7 }, (_, i) => {
          const d = new Date(monday); d.setDate(monday.getDate() + i);
          const key = toKey(d);
          return {
            key, num: d.getDate(),
            dow: ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'][i],
            isToday: key === TODAY, isWeekend: i >= 5,
          };
        });

        const weekStart = weekDays[0].key;
        const weekEnd   = weekDays[6].key;
        const weekLabel = (() => {
          const s = new Date(weekStart + 'T00:00:00');
          const e = new Date(weekEnd + 'T00:00:00');
          const sm = s.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
          const em = e.toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
          return `${sm} – ${em}`;
        })();

        const weekEvents = allEvents.filter(e => e.date && e.date >= weekStart && e.date <= weekEnd);
        const focusEvts  = weekFocusDay ? weekEvents.filter(e => e.date === weekFocusDay).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')) : [];

        const weekSwipe = PanResponder.create({
          onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 16 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
          onPanResponderRelease: (_, g) => {
            if (Math.abs(g.dx) < 50) return;
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setWeekFocusDay(null);
            setWeekOffset(prev => g.dx < 0 ? prev + 1 : prev - 1);
          },
        });

        return (
          <View style={{ flex: 1, backgroundColor: colors.offWhite }} {...weekSwipe.panHandlers}>
            {/* Week nav header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
              <TouchableOpacity onPress={() => { setWeekOffset(p => p - 1); setWeekFocusDay(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={22} color={colors.black} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setWeekOffset(0); setWeekFocusDay(null); }} activeOpacity={0.8}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: weekOffset === 0 ? Colors.yellow : colors.black }}>{weekLabel}</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setWeekOffset(p => p + 1); setWeekFocusDay(null); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                <Ionicons name="chevron-forward" size={22} color={colors.black} />
              </TouchableOpacity>
            </View>

            {/* Day columns header */}
            <View style={{ flexDirection: 'row', backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
              {weekDays.map(d => {
                const isFocus   = weekFocusDay === d.key;
                const hasEvents = weekEvents.some(e => e.date === d.key);
                return (
                  <TouchableOpacity
                    key={d.key}
                    style={{ flex: 1, alignItems: 'center', paddingVertical: 8, backgroundColor: isFocus ? Colors.yellow + '18' : d.isWeekend ? colors.offWhite : 'transparent' }}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setWeekFocusDay(isFocus ? null : d.key); }}
                    activeOpacity={0.7}
                  >
                    <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: d.isToday ? Colors.yellow : d.isWeekend ? colors.gray200 : colors.gray400, textTransform: 'uppercase' }}>{d.dow}</Text>
                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: d.isToday ? Colors.yellow : isFocus ? Colors.yellow + '33' : 'transparent', justifyContent: 'center', alignItems: 'center', marginTop: 2 }}>
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: d.isToday ? Colors.black : d.isWeekend ? colors.gray400 : colors.black }}>{d.num}</Text>
                    </View>
                    {hasEvents && <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: isFocus ? Colors.yellow : colors.gray200, marginTop: 3 }} />}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Event area: focused day or full week */}
            <ScrollView contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE, flexGrow: 1 }}>
              {weekFocusDay ? (
                /* ── Focused day detail ── */
                focusEvts.length === 0 ? (
                  <View style={{ flex: 1, alignItems: 'center', paddingTop: 60, gap: 10 }}>
                    <Text style={{ fontSize: 32 }}>☀️</Text>
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.black }}>Vrije dag</Text>
                    <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400 }}>Geen afspraken</Text>
                  </View>
                ) : (
                  <View style={{ paddingTop: 12, paddingHorizontal: 16, gap: 8 }}>
                    {focusEvts.map(e => {
                      const color = getEventColor(e, streams);
                      return (
                        <TouchableOpacity
                          key={e.id}
                          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openDetailEvent(e); }}
                          style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color + '14', borderLeftWidth: 3, borderLeftColor: color, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 10 }}
                          activeOpacity={0.75}
                        >
                          {e.time && <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: color, width: 38 }}>{e.time.slice(0, 5)}</Text>}
                          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.black, flex: 1 }}>{e.title}</Text>
                          {e.source === 'sous-chef' && <Text style={{ fontSize: 13 }}>👨‍🍳</Text>}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                )
              ) : (
                /* ── Full week overview ── */
                weekEvents.length === 0 ? (
                  <View style={{ flex: 1, alignItems: 'center', paddingTop: 60, gap: 10 }}>
                    <Text style={{ fontSize: 32 }}>🌤️</Text>
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Rustige week</Text>
                    <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400 }}>Geen afspraken gepland</Text>
                  </View>
                ) : weekDays.map(d => {
                  const dayEvts = weekEvents.filter(e => e.date === d.key).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
                  if (dayEvts.length === 0) return null;
                  return (
                    <View key={d.key} style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100, paddingVertical: 10 }}>
                      <View style={{ width: 48, alignItems: 'center', paddingTop: 2 }}>
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: d.isToday ? Colors.yellow : colors.gray400, textTransform: 'uppercase' }}>{d.dow}</Text>
                        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: d.isToday ? Colors.yellow : colors.black }}>{d.num}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 6, paddingRight: 14 }}>
                        {dayEvts.map(e => {
                          const color = getEventColor(e, streams);
                          return (
                            <TouchableOpacity
                              key={e.id}
                              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); openDetailEvent(e); }}
                              style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color + '14', borderLeftWidth: 3, borderLeftColor: color, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, gap: 8 }}
                              activeOpacity={0.75}
                            >
                              {e.time && <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: color, width: 34 }}>{e.time.slice(0, 5)}</Text>}
                              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.black, flex: 1 }} numberOfLines={1}>{e.title}</Text>
                              {e.source === 'sous-chef' && <Text style={{ fontSize: 11 }}>👨‍🍳</Text>}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            {/* FAB */}
            <TouchableOpacity onPress={() => openQuickAdd(weekFocusDay ?? undefined)} style={{ position: 'absolute', right: 20, bottom: insets.bottom + 90, width: 56, height: 56, borderRadius: 28, overflow: 'hidden', shadowColor: Colors.yellow, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }} activeOpacity={0.85}>
              <LinearGradient colors={['#FCC10C', '#E5A800']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="add" size={26} color={Colors.black} />
              </LinearGradient>
            </TouchableOpacity>
          </View>
        );
      })()}

      {/* ── Calendar: month grid ─────────────────────────────────────── */}
      {viewMode === 'calendar' && !dayDetailMode && (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={monthsRef}
            data={months}
            style={{ flex: 1, backgroundColor: colors.offWhite }}
            keyExtractor={m => `${m.year}-${m.month}`}
            initialScrollIndex={MONTHS_BEFORE}
            getItemLayout={(_, index) => ({
              length: (monthOffsets[index + 1] ?? monthOffsets[index]) - monthOffsets[index],
              offset: monthOffsets[index] ?? 0,
              index,
            })}
            onScrollToIndexFailed={() => {}}
            showsVerticalScrollIndicator={false}
            extraData={selectedDate}
            renderItem={({ item: m }) => (
              <MonthGrid
                year={m.year} month={m.month}
                eventsByDate={eventsByDate} streams={streams} selectedDate={selectedDate}
                weekStart={settings.week_start} allEvents={allEvents}
                onDayPress={(d) => {
                  setSelectedDate(d);
                  setDayDetailMode(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              />
            )}
          />
          {/* Vandaag-knop — only visible when not scrolled to today's month */}
          {selectedDate !== TODAY && (
            <TouchableOpacity
              onPress={() => {
                setSelectedDate(TODAY);
                monthsRef.current?.scrollToOffset({ offset: monthOffsetsRef.current[MONTHS_BEFORE] ?? 0, animated: true });
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              style={{ position: 'absolute', bottom: insets.bottom + 98, left: 20, backgroundColor: colors.white, borderRadius: Radius.pill, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4 }}
              activeOpacity={0.8}
            >
              <Ionicons name="today-outline" size={15} color={Colors.yellow} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.black }}>Vandaag</Text>
            </TouchableOpacity>
          )}
          {/* FAB — add event from month view */}
          <TouchableOpacity
            onPress={() => openQuickAdd(selectedDate)}
            style={{ position: 'absolute', right: 20, bottom: insets.bottom + 90, width: 56, height: 56, borderRadius: 28, overflow: 'hidden', shadowColor: Colors.yellow, shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 }}
            activeOpacity={0.85}
          >
            <LinearGradient colors={['#FCC10C', '#E5A800']} style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="add" size={26} color={Colors.black} />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Calendar: day detail (timeline) ─────────────────────────── */}
      {viewMode === 'calendar' && dayDetailMode && (
        <View style={{ flex: 1, backgroundColor: colors.offWhite }} {...daySwipePanResponder.panHandlers}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
            <TouchableOpacity onPress={() => setDayDetailMode(false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 2, width: 70 }} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={colors.black} />
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.black }}>Terug</Text>
            </TouchableOpacity>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedDate(prev => { const d = new Date(prev + 'T12:00:00'); d.setDate(d.getDate() - 1); return toKey(d); }); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                <Ionicons name="chevron-back" size={18} color={colors.gray400} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.black }}>{sectionLabel(selectedDate)}</Text>
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.gray400 }}>W{getWeekNumber(new Date(selectedDate + 'T00:00:00'))}</Text>
              <TouchableOpacity onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSelectedDate(prev => { const d = new Date(prev + 'T12:00:00'); d.setDate(d.getDate() + 1); return toKey(d); }); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} activeOpacity={0.7}>
                <Ionicons name="chevron-forward" size={18} color={colors.gray400} />
              </TouchableOpacity>
            </View>
            <TouchableOpacity onPress={() => openQuickAdd(selectedDate)} style={{ width: 70, alignItems: 'flex-end' }} activeOpacity={0.75}>
              <View style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.yellow, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="add" size={20} color={Colors.black} />
              </View>
            </TouchableOpacity>
          </View>

          {/* All-day events — sticky above the scrollable timeline */}
          {selectedDayEvents.filter(e => !e.time).length > 0 && (
            <View style={{ backgroundColor: colors.white, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100, padding: 10, paddingHorizontal: 14 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6 }}>Hele dag</Text>
              {selectedDayEvents.filter(e => !e.time).map(e => {
                const color = getEventColor(e, streams);
                return (
                  <View key={e.id} style={{ position: 'relative', marginBottom: 4 }}>
                    <TouchableOpacity onPress={() => { if (deletingId) { setDeletingId(null); return; } openEditEvent(e); }} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDeletingId(e.id); }} activeOpacity={0.8}
                      style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: color + '18', borderLeftWidth: 3, borderLeftColor: color, borderRadius: 10, padding: 10 }}>
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: color, flex: 1 }}>{e.title}</Text>
                      {e.recurrence && <Text style={{ fontSize: 11, color: color, opacity: 0.6, marginRight: 6 }}>↺</Text>}
                      {e.source === 'phone' && (
                        <View style={{ backgroundColor: color + '22', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color: color }}>iPhone</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                    {deletingId === e.id && (
                      <TouchableOpacity
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#EF4444', borderRadius: 10, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }}
                        onPress={() => deleteEvent(e)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="trash-outline" size={18} color="#fff" />
                        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>Verwijder</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <ScrollView ref={dayDetailScrollRef} contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }} showsVerticalScrollIndicator={false}>
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
                    style={{ position: 'absolute', left: 58, right: 8, top: displayTop, height: 56, borderRadius: 13, zIndex: isDragging ? 10 : 1, shadowColor: color, shadowOpacity: isDragging ? 0.25 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: isDragging ? 6 : 0 }}>
                    <TouchableOpacity onPress={() => { if (deletingId) { setDeletingId(null); return; } if (!isDragging) openEditEvent(e); }} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDeletingId(e.id); }} activeOpacity={0.85}
                      style={{ flex: 1, backgroundColor: color + (isDragging ? '30' : '18'), borderRadius: 13, borderLeftWidth: 3, borderLeftColor: color, padding: 8 }}>
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: color }} numberOfLines={1}>{e.title}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 11, color: color, opacity: 0.75 }}>{isDragging ? dragTimeLabel : e.time}</Text>
                        {e.recurrence && <Text style={{ fontSize: 11, color: color, opacity: 0.6 }}>↺</Text>}
                        {e.source === 'phone' && (
                          <View style={{ backgroundColor: color + '22', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
                            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 9, color: color }}>iPhone</Text>
                          </View>
                        )}
                      </View>
                    </TouchableOpacity>
                    {deletingId === e.id && (
                      <TouchableOpacity
                        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#EF4444', borderRadius: 13, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }}
                        onPress={() => deleteEvent(e)}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="trash-outline" size={18} color="#fff" />
                        <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>Verwijder</Text>
                      </TouchableOpacity>
                    )}
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
              {selectedEvent.source === 'sous-chef' ? (
                <TouchableOpacity onPress={() => { setSelectedEvent(null); openEditEvent(selectedEvent); }} style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: colors.gray100, justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="pencil-outline" size={16} color={colors.black} />
                </TouchableOpacity>
              ) : <View style={{ width: 34 }} />}
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
              {selectedEvent.source === 'sous-chef' && streams.length > 0 && (
                <View style={{ gap: 10 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Categorie</Text>
                  {detailSaving ? (
                    <ActivityIndicator size="small" color={Colors.yellow} />
                  ) : (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                      <TouchableOpacity
                        onPress={() => saveDetailStream(null)}
                        style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: detailStream === null ? colors.black : colors.gray100 }}
                        activeOpacity={0.75}
                      >
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: detailStream === null ? colors.offWhite : colors.gray400 }}>Geen</Text>
                      </TouchableOpacity>
                      {streams.map(st => {
                        const active = detailStream === st.claude_key;
                        return (
                          <TouchableOpacity
                            key={st.id}
                            onPress={() => saveDetailStream(active ? null : st.claude_key)}
                            style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: active ? st.color + '22' : colors.gray100, borderWidth: active ? 1.5 : 0, borderColor: st.color }}
                            activeOpacity={0.75}
                          >
                            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: active ? st.color : colors.gray400 }}>{st.emoji} {st.name}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  )}
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>

      {/* QuickAdd modal */}
      <Modal visible={quickAddVisible} transparent animationType="slide" onRequestClose={() => setQuickAddVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }} onPress={() => setQuickAddVisible(false)}>
            <Pressable style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 32, gap: 14 }} onPress={() => {}}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.gray200, alignSelf: 'center', marginBottom: 4 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Nieuwe afspraak</Text>
                <TouchableOpacity onPress={() => setQuickAddVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={16} color={colors.gray600} />
                </TouchableOpacity>
              </View>
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
              {/* Stream/category picker */}
              {streams.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Categorie</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => setQuickAddStream(null)}
                      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: quickAddStream === null ? colors.black : colors.gray100 }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: quickAddStream === null ? colors.offWhite : colors.gray400 }}>Geen</Text>
                    </TouchableOpacity>
                    {streams.map(st => {
                      const active = quickAddStream === st.claude_key;
                      return (
                        <TouchableOpacity
                          key={st.id}
                          onPress={() => setQuickAddStream(active ? null : st.claude_key)}
                          style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: active ? st.color + '22' : colors.gray100, borderWidth: active ? 1.5 : 0, borderColor: st.color }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: active ? st.color : colors.gray400 }}>{st.emoji} {st.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Afspraak bewerken</Text>
                <TouchableOpacity onPress={() => setEditEvent(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={16} color={colors.gray600} />
                </TouchableOpacity>
              </View>
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
              {editEvent?.source === 'sous-chef' && streams.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Categorie</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => setEditStream(null)}
                      style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, backgroundColor: editStream === null ? colors.black : colors.gray100 }}
                      activeOpacity={0.75}
                    >
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: editStream === null ? colors.offWhite : colors.gray400 }}>Geen</Text>
                    </TouchableOpacity>
                    {streams.map(st => {
                      const active = editStream === st.claude_key;
                      return (
                        <TouchableOpacity
                          key={st.id}
                          onPress={() => setEditStream(active ? null : st.claude_key)}
                          style={{ paddingHorizontal: 13, paddingVertical: 8, borderRadius: Radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: active ? st.color + '22' : colors.gray100, borderWidth: active ? 1.5 : 0, borderColor: st.color }}
                          activeOpacity={0.75}
                        >
                          <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: active ? st.color : colors.gray400 }}>{st.emoji} {st.name}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
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

  // ── Clean warm header ──
  header:     { paddingHorizontal: 22, paddingBottom: 12 },
  headerRow:  { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerGreet: { fontFamily: 'Inter_400Regular', fontSize: 14.5, marginBottom: 3, letterSpacing: -0.1 },
  headerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 27, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 30 },

  // ── Segmented control (Lijst / Maand) ──
  segControl: { flexDirection: 'row', borderRadius: 10, padding: 2, marginBottom: 3 },
  segBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8 },
  segBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  filterRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  pill:           { height: 34, paddingHorizontal: 15, borderRadius: Radius.pill, justifyContent: 'center' },
  chip:           { height: 32, paddingHorizontal: 13, borderRadius: Radius.pill, justifyContent: 'center' },
  pillActive:     { },
  pillText:       { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
  pillTextActive: { },
  unlinkBtn: { padding: 7 },

  permBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.yellowLight, marginHorizontal: 16, marginBottom: 8, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  permText:   { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.black },
  pastToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginBottom: 4 },
  pastToggleText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.gray400 },

  sectionHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 18, paddingBottom: 8 },
  sectionHeaderPast: { opacity: 0.45 },
  dot:               { width: 6, height: 6, borderRadius: 3 },
  dotToday:          { width: 8, height: 8, borderRadius: 4 },
  sectionLabel:      { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionLabelToday: { },
  sectionLabelPast:  { },

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
