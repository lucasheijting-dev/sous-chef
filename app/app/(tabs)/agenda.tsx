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
} from 'react-native';
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
const MONTH_H            = 356;
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

function MonthGrid({ year, month, eventDates, selectedDate, onDayPress }: {
  year: number; month: number; eventDates: Set<string>; selectedDate: string; onDayPress: (k: string) => void;
}) {
  const { colors } = useTheme();
  const firstDow      = new Date(year, month, 1).getDay();
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1;
  const daysInMonth   = new Date(year, month + 1, 0).getDate();

  const cells: (null | { key: string; num: number; isToday: boolean; hasEvent: boolean })[] = [];
  for (let b = 0; b < leadingBlanks; b++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    const key = toKey(new Date(year, month, d));
    cells.push({ key, num: d, isToday: key === TODAY, hasEvent: eventDates.has(key) });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const label = new Date(year, month, 1).toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });

  return (
    <View style={cal.monthBlock}>
      <Text style={[cal.monthLabel, { color: colors.black }]}>{label[0].toUpperCase() + label.slice(1)}</Text>
      <View style={cal.weekRow}>
        {['Ma','Di','Wo','Do','Vr','Za','Zo'].map(n => <Text key={n} style={[cal.weekDay, { color: colors.gray400 }]}>{n}</Text>)}
      </View>
      <View style={cal.grid}>
        {cells.map((cell, i) =>
          cell === null ? <View key={`b${i}`} style={cal.cell} /> : (
            <TouchableOpacity key={cell.key} style={cal.cell} onPress={() => onDayPress(cell.key)} activeOpacity={0.7}>
              <View style={[cal.circle, cell.isToday && cal.circleToday, selectedDate === cell.key && !cell.isToday && { backgroundColor: colors.black }]}>
                <Text style={[cal.num, { color: colors.black }, cell.isToday && { color: Colors.black }, selectedDate === cell.key && !cell.isToday && { color: colors.white }, cell.key < TODAY && !cell.isToday && { color: colors.gray200 }]}>
                  {cell.num}
                </Text>
              </View>
              {cell.hasEvent
                ? <View style={[cal.dot, cell.isToday ? { backgroundColor: Colors.black } : (selectedDate === cell.key ? { backgroundColor: colors.white } : (cell.key < TODAY ? { backgroundColor: colors.gray200 } : { backgroundColor: Colors.yellow }))]} />
                : <View style={cal.dotEmpty} />
              }
            </TouchableOpacity>
          )
        )}
      </View>
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
  const [quickAddDate, setQuickAddDate]       = useState<'today' | 'tomorrow'>('today');
  const [quickAddTime, setQuickAddTime]       = useState('');
  const [quickAddSaving, setQuickAddSaving]   = useState(false);

  const [viewMode, setViewMode]           = useState<'list' | 'calendar'>('list');
  const [selectedDate, setSelectedDate]   = useState(TODAY);
  const [dayDetailMode, setDayDetailMode] = useState(false);
  const monthsRef = useRef<FlatList>(null);

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
    const end = new Date(now); end.setDate(end.getDate() + 14);
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
            const end2   = new Date(now); end2.setDate(end2.getDate() + 14);
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

  const eventDates   = useMemo(() => new Set(allEvents.filter(e => !!e.date).map(e => e.date!)), [allEvents]);
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

  async function saveQuickEvent() {
    if (!user || !quickAddTitle.trim() || quickAddSaving) return;
    setQuickAddSaving(true);
    const now = new Date(); now.setHours(0, 0, 0, 0);
    if (quickAddDate === 'tomorrow') now.setDate(now.getDate() + 1);
    const dateStr = toKey(now);
    const { data } = await supabase.from('events').insert({
      user_id: user.id, title: quickAddTitle.trim(), date: dateStr,
      time: quickAddTime.trim() || null,
    }).select().single();
    if (data) {
      setAllEvents(prev => [...prev, { ...data, source: 'sous-chef' as const }]);
      setTimePeriod(quickAddDate === 'today' ? 'today' : 'tomorrow');
    }
    setQuickAddTitle(''); setQuickAddTime('');
    setQuickAddVisible(false);
    setQuickAddSaving(false);
  }

  function QuickAddModal() {
    return (
      <Modal visible={quickAddVisible} transparent animationType="slide" onRequestClose={() => setQuickAddVisible(false)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={() => setQuickAddVisible(false)}>
          <Pressable style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: insets.bottom + 24, gap: 16 }} onPress={() => {}}>
            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.gray200, alignSelf: 'center', marginBottom: 4 }} />
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Nieuwe afspraak</Text>
            <TextInputRN
              style={{ borderWidth: 1, borderColor: Colors.yellow + '60', borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, color: colors.black, fontFamily: 'Inter_400Regular', fontSize: 16, backgroundColor: colors.offWhite }}
              value={quickAddTitle}
              onChangeText={setQuickAddTitle}
              placeholder="Wat is de afspraak?"
              placeholderTextColor={colors.gray400}
              autoFocus
              selectionColor={Colors.yellow}
            />
            <TextInputRN
              style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: Radius.md, paddingHorizontal: 16, paddingVertical: 14, color: colors.black, fontFamily: 'Inter_400Regular', fontSize: 16, backgroundColor: colors.offWhite }}
              value={quickAddTime}
              onChangeText={setQuickAddTime}
              placeholder="Tijd (bijv. 14:30) — optioneel"
              placeholderTextColor={colors.gray400}
              keyboardType="numbers-and-punctuation"
              selectionColor={Colors.yellow}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['today', 'tomorrow'] as const).map(d => (
                <TouchableOpacity key={d} onPress={() => setQuickAddDate(d)} style={{ flex: 1, paddingVertical: 12, borderRadius: Radius.pill, backgroundColor: quickAddDate === d ? Colors.yellow : colors.gray100, alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: quickAddDate === d ? Colors.black : colors.gray400 }}>
                    {d === 'today' ? 'Vandaag' : 'Morgen'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity onPress={saveQuickEvent} disabled={!quickAddTitle.trim() || quickAddSaving} style={{ backgroundColor: Colors.yellow, borderRadius: Radius.pill, paddingVertical: 16, alignItems: 'center', opacity: quickAddTitle.trim() ? 1 : 0.4 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black }}>Opslaan</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    );
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
        onPress={() => setQuickAddVisible(true)}
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
              eventDates={eventDates} selectedDate={selectedDate}
              onDayPress={(d) => {
                setSelectedDate(d);
                setDayDetailMode(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            />
          )}
        />
      )}

      {/* ── Calendar: day detail ─────────────────────────────────────── */}
      {viewMode === 'calendar' && dayDetailMode && (
        <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
          <View style={[cal.dayDetailHeader, { backgroundColor: colors.white, borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setDayDetailMode(false)} style={cal.dayDetailBack} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={Colors.black} />
              <Text style={[cal.dayDetailBackText, { color: Colors.black }]}>Terug</Text>
            </TouchableOpacity>
            <Text style={[cal.dayDetailTitle, { color: colors.black }]}>{sectionLabel(selectedDate)}</Text>
            <TouchableOpacity onPress={() => setQuickAddVisible(true)} style={{ width: 70, alignItems: 'flex-end', paddingRight: 4 }}>
              <Ionicons name="add-circle-outline" size={24} color={Colors.yellow} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: TAB_BAR_CLEARANCE }} showsVerticalScrollIndicator={false}>
            {selectedDayEvents.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
                <View style={[s.emptyIconBox, { backgroundColor: colors.gray100 }]}>
                  <Text style={{ fontSize: 32 }}>📅</Text>
                </View>
                <Text style={[s.emptyTitle, { color: colors.black }]}>Geen afspraken</Text>
                <Text style={[s.emptyText, { color: colors.gray400 }]}>Geen afspraken op {sectionLabel(selectedDate).toLowerCase()}</Text>
              </View>
            ) : selectedDayEvents.map(e => {
              const sc = e.source === 'sous-chef' ? streams.find(st => st.claude_key === e.calendar_stream)?.color : undefined;
              return (
                <TouchableOpacity
                  key={e.id}
                  onLongPress={() => setDeleteTarget(e)}
                  style={[cal.dayEventCard, { backgroundColor: colors.white }]}
                  activeOpacity={0.8}
                >
                  {sc && <View style={{ width: 4, borderRadius: 2, backgroundColor: sc, marginRight: 12, alignSelf: 'stretch' }} />}
                  <Text style={cal.eventEmoji}>{eventEmoji(e.title)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[cal.eventTitle, { color: colors.black }]}>{e.title}</Text>
                    {(e.time || e.source === 'phone') && (
                      <Text style={[cal.eventSub, { color: colors.gray400 }]}>
                        {[e.time, e.source === 'phone' ? 'iPhone-agenda' : null].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="trash-outline" size={16} color={colors.gray200} />
                </TouchableOpacity>
              );
            })}
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

      <QuickAddModal />

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _AgendaTabFull() {
  const { settings } = useModuleSettings();
  if (settings.calendar_mode === 'lite') return <AgendaLite />;

  const { user }   = useUser();
  const { colors } = useTheme();
  const insets     = useSafeAreaInsets();
  const listRef    = useRef<FlatList<FlatItem>>(null);
  const monthsRef  = useRef<FlatList>(null);
  const chipScrollRef = useRef<ScrollView>(null);

  const [allSections, setAllSections]   = useState<Section[]>([]);
  const [timePeriod, setTimePeriod]     = useState<TimePeriod>('today');
  const [streamFilter, setStreamFilter] = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [calPermission, setCalPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [calHidden, setCalHidden]         = useState(false);
  const [viewMode, setViewMode]         = useState<ViewMode>('calendar');
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [dayDetailMode, setDayDetailMode] = useState(false);
  const [streams, setStreams]           = useState<CalendarStream[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<MergedEvent | null>(null);

  const breatheAnim  = useRef(new Animated.Value(1)).current;
  const scrollYAnim  = useRef(new Animated.Value(0)).current;

  const PERIOD_LABELS: [TimePeriod, string][] = [
    ['today', 'Vandaag'],
    ['tomorrow', 'Morgen'],
    ['thisweek', 'Deze week'],
    ['nextweek', 'Volgende week'],
  ];

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

  const fetchEvents = useCallback(async (overrideHidden = calHidden) => {
    const results: MergedEvent[] = [];
    if (user && user.id !== 'dev') {
      const { data } = await supabase.from('events').select('*').eq('user_id', user.id).order('date', { ascending: true, nullsFirst: false });
      if (data) results.push(...data.map((e: CalEvent) => ({ ...e, source: 'sous-chef' as const })));
    }
    if (!overrideHidden && Platform.OS !== 'web') {
      const { status } = await Calendar.getCalendarPermissionsAsync();
      if (status === 'granted') {
        setCalPermission('granted');
        const phoneEvts = await fetchPhoneEvents();
        const scKeys = new Set(results.map(e => `${e.title?.toLowerCase()}|${e.date}`));
        results.push(...phoneEvts.filter(e => !scKeys.has(`${e.title?.toLowerCase()}|${e.date}`)));
      } else {
        setCalPermission(status === 'denied' ? 'denied' : 'unknown');
      }
    }
    setAllSections(groupByDate(results));
    setLoading(false);
    setRefreshing(false);
  }, [user, calHidden]);

  useEffect(() => {
    fetchEvents();
    if (!user || user.id === 'dev') return;
    supabase.from('calendar_streams').select('*').eq('user_id', user.id)
      .then(({ data }) => { if (data) setStreams(data); });
    const ch = supabase.channel('events-ch')
      .on('postgres_changes' as any, { event: '*', schema: 'public', table: 'events', filter: `user_id=eq.${user.id}` }, fetchEvents)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, fetchEvents]);

  const months = useMemo(() => {
    const now = new Date();
    return Array.from({ length: MONTHS_BEFORE + 1 + MONTHS_AFTER }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - MONTHS_BEFORE + i, 1);
      return { year: d.getFullYear(), month: d.getMonth(), index: i };
    });
  }, []);

  const eventDates   = useMemo(() => new Set(allSections.map(s => s.dateKey)), [allSections]);
  const eventsByDate = useMemo(() => { const m = new Map<string, MergedEvent[]>(); for (const s of allSections) m.set(s.dateKey, s.data); return m; }, [allSections]);
  const phoneConnected = calPermission === 'granted' && !calHidden;

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
    const allEvents = allSections.flatMap(s => s.data);
    for (const p of PERIOD_ORDER) {
      const [start, end] = ranges[p];
      counts[p] = allEvents.filter(e => e.date && e.date >= start && e.date <= end).length;
    }
    return counts;
  }, [allSections]);

  const sections = useMemo(() => {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const offsetDay = (n: number) => { const d = new Date(now); d.setDate(d.getDate() + n); return toKey(d); };
    const ranges: Record<TimePeriod, [string, string]> = {
      today:    [offsetDay(0), offsetDay(0)],
      tomorrow: [offsetDay(1), offsetDay(1)],
      thisweek: [offsetDay(0), offsetDay(6)],
      nextweek: [offsetDay(7), offsetDay(13)],
    };
    const [start, end] = ranges[timePeriod];
    let base = allSections.filter(s => s.dateKey >= start && s.dateKey <= end);
    if (streamFilter) {
      base = base.map(s => ({ ...s, data: s.data.filter(e => e.calendar_stream === streamFilter || (streamFilter === '__phone' && e.source === 'phone')) })).filter(s => s.data.length > 0);
    }
    return base;
  }, [allSections, timePeriod, streamFilter]);

  const { flatData, stickyIndices } = useMemo(() => {
    const items: FlatItem[] = []; const sticky: number[] = [];
    for (const section of sections) {
      sticky.push(items.length);
      items.push({ type: 'header', section });
      section.data.forEach((item, idx) => items.push({ type: 'item', item, section, isLast: idx === section.data.length - 1 }));
    }
    return { flatData: items, stickyIndices: sticky };
  }, [sections]);

  const upcomingCount = allSections.filter(s => !s.isPast).reduce((n, s) => n + s.data.length, 0);
  const thisWeekCount = allSections.filter(s => !s.isPast && Math.round((new Date(s.dateKey + 'T00:00:00').getTime() - new Date().setHours(0,0,0,0)) / 86400000) <= 7).reduce((n, s) => n + s.data.length, 0);

  if (loading) return <View style={[s.center, { backgroundColor: colors.offWhite }]}><ActivityIndicator size="large" color={Colors.yellow} /></View>;

  const selectedEvents = eventsByDate.get(selectedDate) ?? [];

  function selectPeriod(p: TimePeriod) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setTimePeriod(p as TimePeriod);
    const index = PERIOD_ORDER.indexOf(p);
    chipScrollRef.current?.scrollTo({ x: Math.max(0, index * 90 - screenWidth / 2 + 45), animated: true });
  }

  async function deleteEvent(event: MergedEvent) {
    if (event.source !== 'sous-chef') return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await supabase.from('events').delete().eq('id', event.id);
    setAllSections(prev => prev.map(sec => ({ ...sec, data: sec.data.filter(e => e.id !== event.id) })).filter(sec => sec.data.length > 0));
    setDeleteTarget(null);
  }

  const bannerTranslateY = scrollYAnim.interpolate({
    inputRange: [0, 100],
    outputRange: [0, -20],
    extrapolate: 'clamp',
  });

  return (
    <View style={[s.container, { backgroundColor: colors.offWhite }]}>

      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <View>
        <Animated.View style={[s.banner, { paddingTop: insets.top + 44, transform: [{ translateY: bannerTranslateY }] }]}>
          <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
          <View style={s.bannerRow}>
            <Text style={s.bannerTitle}>Agenda</Text>
          </View>
          <View style={s.bannerStats}>
            <View style={s.statTile}>
              <Text style={s.statNum}>{thisWeekCount}</Text>
              <Text style={s.statLabel}>deze week</Text>
            </View>
            <View style={[s.statTile, s.statTileAccent]}>
              <Text style={[s.statNum, { color: Colors.black }]}>{upcomingCount}</Text>
              <Text style={[s.statLabel, { color: 'rgba(0,0,0,0.55)' }]}>aankomend</Text>
            </View>
          </View>
        </Animated.View>

        {/* Time period pills */}
        <View style={{ flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 }}>
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
        <View style={{ height: 1, backgroundColor: '#E8E8E8', marginHorizontal: 20, marginBottom: 8 }} />

        {/* Stream category chips */}
        {streams.length > 0 && (
          <View style={{ flexGrow: 0, flexShrink: 0, paddingHorizontal: 20, paddingBottom: 12 }}>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12 }}>Categorie</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TouchableOpacity onPress={() => setStreamFilter(null)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === null ? Colors.yellow : '#DDDCDC' }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111', lineHeight: 18 }}>Alles</Text>
              </TouchableOpacity>
              {streams.map(st => (
                <TouchableOpacity key={st.id} onPress={() => setStreamFilter(streamFilter === st.claude_key ? null : st.claude_key)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === st.claude_key ? st.color : '#DDDCDC' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: streamFilter === st.claude_key ? '#fff' : '#111', lineHeight: 18 }}>{st.emoji} {st.name}</Text>
                </TouchableOpacity>
              ))}
              {phoneConnected && (
                <TouchableOpacity onPress={() => setStreamFilter(streamFilter === '__phone' ? null : '__phone')} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === '__phone' ? '#333' : '#DDDCDC' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: streamFilter === '__phone' ? '#fff' : '#111', lineHeight: 18 }}>📱 iPhone</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          </View>
        )}

        {/* View mode toggle */}
        <View style={[s.toggleWrap, { backgroundColor: colors.offWhite }]}>
          <TouchableOpacity style={s.tabTextBtn} onPress={() => { setViewMode('list'); setDayDetailMode(false); }}>
            <Text style={[s.tabTextLabel, { color: viewMode === 'list' ? colors.black : colors.gray400 }]}>Lijst</Text>
            {viewMode === 'list' && <View style={[s.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.tabTextBtn}
            onPress={() => {
              setViewMode('calendar');
              setDayDetailMode(false);
              setTimeout(() => monthsRef.current?.scrollToIndex({ index: MONTHS_BEFORE, animated: false }), 80);
            }}
          >
            <Text style={[s.tabTextLabel, { color: viewMode === 'calendar' ? colors.black : colors.gray400 }]}>Kalender</Text>
            {viewMode === 'calendar' && <View style={[s.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── List view ─────────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <FlatList
          ref={listRef}
          data={flatData}
          keyExtractor={(item, i) => item.type === 'header' ? `h-${item.section.dateKey}` : `i-${item.item.id}-${i}`}
          stickyHeaderIndices={stickyIndices}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE }}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollYAnim } } }], { useNativeDriver: false })}
          scrollEventThrottle={16}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEvents(); }} tintColor={Colors.yellow} />}
          ListHeaderComponent={
            <View {...swipePanResponder.panHandlers}>
              {calPermission === 'unknown' && !calHidden && Platform.OS !== 'web' && (
                <TouchableOpacity style={[s.permBanner, { backgroundColor: colors.yellowLight }]} onPress={async () => { await fetchPhoneEvents(); setCalPermission('granted'); fetchEvents(); }}>
                  <Ionicons name="phone-portrait-outline" size={15} color={colors.black} />
                  <Text style={[s.permText, { color: colors.black }]}>Toon ook je iPhone-agenda</Text>
                  <Ionicons name="chevron-forward" size={13} color={colors.gray400} />
                </TouchableOpacity>
              )}
              {sections.length === 0 && (
                <View style={s.empty}>
                  <Animated.View style={[s.emptyIconBox, { backgroundColor: colors.gray100, transform: [{ scale: breatheAnim }] }]}>
                    <Text style={{ fontSize: 32 }}>📅</Text>
                  </Animated.View>
                  <Text style={[s.emptyTitle, { color: colors.black }]}>Niets gepland</Text>
                  <Text style={[s.emptyText, { color: colors.gray400 }]}>Stuur "tandarts vrijdag 14u" via WhatsApp.</Text>
                </View>
              )}
            </View>
          }
          renderItem={({ item }) => {
            if (item.type === 'header') {
              const { section } = item;
              return (
                <View style={[s.sectionHeader, { backgroundColor: colors.offWhite }, section.isPast && s.sectionHeaderPast]}>
                  <View style={[s.dot, { backgroundColor: colors.gray200 }, section.isToday && s.dotToday]} />
                  <Text style={[s.sectionLabel, { color: colors.gray400 }, section.isToday && s.sectionLabelToday, section.isPast && { color: colors.gray400 }]}>{section.label}</Text>
                </View>
              );
            }
            const { item: event, section, isLast } = item;
            const cl = daysUntil(section.dateKey);
            const streamColor = event.source === 'sous-chef'
              ? streams.find(s => s.claude_key === event.calendar_stream)?.color
              : undefined;
            const eventPast = event.date ? isPast(event.date) : false;

            const cardContent = (
              <View style={[s.cardWrap, isLast && { marginBottom: 4 }, { opacity: eventPast ? 0.45 : 1 }]}>
                <Pressable
                  style={({ pressed }) => [s.card, { backgroundColor: colors.white, transform: [{ scale: pressed ? 0.97 : 1 }] }, section.isPast && s.cardPast]}
                  onPress={() => {}}
                >
                  <View style={[s.accent, streamColor ? { backgroundColor: streamColor } : event.source === 'phone' ? { backgroundColor: colors.gray200 } : section.isToday ? s.accentToday : { backgroundColor: colors.gray200 }]} />
                  <Text style={s.emoji}>{eventEmoji(event.title)}</Text>
                  <View style={s.cardBody}>
                    <Text style={[s.cardTitle, { color: colors.black }, section.isPast && { color: colors.gray400 }]} numberOfLines={1}>{event.title}</Text>
                    <View style={s.metaRow}>
                      {event.time && <View style={[s.tag, { backgroundColor: colors.gray100 }]}><Ionicons name="time-outline" size={10} color={colors.gray400} /><Text style={[s.tagText, { color: colors.gray600 }]}>{event.time}</Text></View>}
                      {event.source === 'phone' && <View style={[s.tag, { backgroundColor: colors.gray100 }]}><Ionicons name="phone-portrait-outline" size={10} color={colors.gray400} /><Text style={[s.tagText, { color: colors.gray600 }]}>iPhone</Text></View>}
                      {event.recurrence && event.source === 'sous-chef' && <View style={[s.tag, { backgroundColor: colors.gray100 }]}><Ionicons name="repeat" size={10} color={colors.gray600} /><Text style={[s.tagText, { color: colors.gray600 }]}>{event.recurrence === 'yearly' ? 'Jaarlijks' : event.recurrence === 'monthly' ? 'Maandelijks' : 'Wekelijks'}</Text></View>}
                      {(event.reminder_days_before ?? 0) > 0 && event.source === 'sous-chef' && <View style={[s.tag, { backgroundColor: colors.gray100 }]}><Ionicons name="notifications-outline" size={10} color={colors.gray600} /><Text style={[s.tagText, { color: colors.gray600 }]}>{event.reminder_days_before}d reminder</Text></View>}
                    </View>
                  </View>
                  {cl && <Text style={[s.countLabel, { color: colors.gray400 }, section.isPast && { color: colors.gray400 }]}>{cl}</Text>}
                </Pressable>
              </View>
            );

            if (event.source !== 'sous-chef') return cardContent;

            return (
              <Swipeable
                key={event.id}
                renderRightActions={() => (
                  <View style={{ width: 72, justifyContent: 'center', alignItems: 'center', paddingBottom: isLast ? 4 : 8, paddingHorizontal: 8 }}>
                    <View style={{ backgroundColor: '#E74C3C', borderRadius: Radius.lg, flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center' }}>
                      <Ionicons name="trash-outline" size={20} color="#fff" />
                    </View>
                  </View>
                )}
                onSwipeableOpen={() => setDeleteTarget(event)}
              >
                {cardContent}
              </Swipeable>
            );
          }}
        />
      )}

      {/* ── Calendar view ──────────────────────────────────────────────────── */}
      {viewMode === 'list' && (
        <LinearGradient
          colors={[`${colors.offWhite}00`, colors.offWhite]}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, pointerEvents: 'none' }}
        />
      )}


      {/* ── Calendar: month grid ──────────────────────────────────────────── */}
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
              eventDates={eventDates} selectedDate={selectedDate}
              onDayPress={(d) => {
                setSelectedDate(d);
                setDayDetailMode(true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
            />
          )}
        />
      )}

      {/* ── Calendar: day detail ──────────────────────────────────────────── */}
      {viewMode === 'calendar' && dayDetailMode && (
        <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
          <View style={[cal.dayDetailHeader, { backgroundColor: colors.white, borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setDayDetailMode(false)} style={cal.dayDetailBack} activeOpacity={0.7}>
              <Ionicons name="chevron-back" size={22} color={Colors.black} />
              <Text style={[cal.dayDetailBackText, { color: Colors.black }]}>Terug</Text>
            </TouchableOpacity>
            <Text style={[cal.dayDetailTitle, { color: colors.black }]}>{sectionLabel(selectedDate)}</Text>
            <View style={{ width: 70 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: TAB_BAR_CLEARANCE }} showsVerticalScrollIndicator={false}>
            {selectedEvents.length === 0 ? (
              <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
                <View style={[s.emptyIconBox, { backgroundColor: colors.gray100 }]}>
                  <Text style={{ fontSize: 32 }}>📅</Text>
                </View>
                <Text style={[s.emptyTitle, { color: colors.black }]}>Geen afspraken</Text>
                <Text style={[s.emptyText, { color: colors.gray400 }]}>
                  Geen afspraken op {sectionLabel(selectedDate).toLowerCase()}
                </Text>
              </View>
            ) : selectedEvents.map(e => {
              const sc = e.source === 'sous-chef' ? streams.find(st => st.claude_key === e.calendar_stream)?.color : undefined;
              return (
                <View key={e.id} style={[cal.dayEventCard, { backgroundColor: colors.white }]}>
                  {sc && <View style={{ width: 4, borderRadius: 2, backgroundColor: sc, marginRight: 12, alignSelf: 'stretch' }} />}
                  <Text style={cal.eventEmoji}>{eventEmoji(e.title)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[cal.eventTitle, { color: colors.black }]}>{e.title}</Text>
                    {(e.time || e.source === 'phone' || e.recurrence) && (
                      <Text style={[cal.eventSub, { color: colors.gray400 }]}>
                        {[e.time, e.source === 'phone' ? 'iPhone-agenda' : null, e.recurrence === 'yearly' ? 'Jaarlijks' : e.recurrence === 'monthly' ? 'Maandelijks' : e.recurrence === 'weekly' ? 'Wekelijks' : null].filter(Boolean).join(' · ')}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.gray200} />
                </View>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Delete confirmation bottom sheet */}
      <Modal visible={!!deleteTarget} transparent animationType="fade" onRequestClose={() => setDeleteTarget(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black, marginBottom: 8 }}>Afspraak verwijderen?</Text>
            <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray400, marginBottom: 24 }}>
              "{deleteTarget?.title}" wordt{deleteTarget?.source === 'phone' ? ' uit je iPhone-agenda verwijderd' : ' permanent verwijderd'}.
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
    </View>
  );
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
