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
  Linking,
  Alert,
  PanResponder,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Calendar from 'expo-calendar';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { CalEvent } from '@/lib/types';
import { Colors, Radius, Shadow, ThemeColors } from '@/constants/Design';
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

// ── AgendaLite (period pills + stream chips) ──────────────────────────────────

function AgendaLite() {
  const { user }   = useUser();
  const { colors } = useTheme();
  const insets     = useSafeAreaInsets();

  const [allEvents, setAllEvents]       = useState<MergedEvent[]>([]);
  const [streams, setStreams]           = useState<CalendarStream[]>([]);
  const [loading, setLoading]           = useState(true);
  const [timePeriod, setTimePeriod]     = useState<TimePeriod>('today');
  const [streamFilter, setStreamFilter] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.id === 'dev') { setLoading(false); return; }
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const end = new Date(now); end.setDate(end.getDate() + 14);
    const endKey = toKey(end);
    Promise.all([
      supabase.from('events').select('*').eq('user_id', user.id).gte('date', TODAY).lte('date', endKey),
      supabase.from('calendar_streams').select('*').eq('user_id', user.id),
    ]).then(([evtRes, streamRes]) => {
      setAllEvents((evtRes.data ?? []).map((e: CalEvent) => ({ ...e, source: 'sous-chef' as const })));
      if (streamRes.data) setStreams(streamRes.data);
      setLoading(false);
    });
  }, [user]);

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

  const periodLabel = timePeriod === 'today' ? 'Vandaag' : timePeriod === 'tomorrow' ? 'Morgen' : 'Volgende week';

  return (
    <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
      {/* Header */}
      <View style={[s.banner, { paddingTop: insets.top + 24, paddingBottom: 20 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
        <Text style={s.bannerTitle}>Agenda</Text>
      </View>

      {/* Period pills — ScrollView so pills stay content-width */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 }}>
        {([['today', 'Vandaag'], ['tomorrow', 'Morgen'], ['thisweek', 'Deze week'], ['nextweek', 'Volgende week']] as [TimePeriod, string][]).map(([p, label]) => (
          <TouchableOpacity
            key={p}
            onPress={() => { setTimePeriod(p); setStreamFilter(null); }}
            style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 24, backgroundColor: timePeriod === p ? Colors.yellow : '#DDDCDC' }}
          >
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111' }}>{label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Stream chips */}
      {streams.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 10 }}>
          <TouchableOpacity
            onPress={() => setStreamFilter(null)}
            style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === null ? Colors.yellow : '#DDDCDC' }}
          >
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111' }}>Alles</Text>
          </TouchableOpacity>
          {streams.map(st => (
            <TouchableOpacity
              key={st.id}
              onPress={() => setStreamFilter(streamFilter === st.claude_key ? null : st.claude_key)}
              style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 24, backgroundColor: streamFilter === st.claude_key ? st.color : '#DDDCDC' }}
            >
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: streamFilter === st.claude_key ? '#fff' : '#111' }}>{st.emoji} {st.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {/* Events */}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 140 }}>
        {loading ? (
          <ActivityIndicator color={Colors.yellow} style={{ marginTop: 40 }} />
        ) : visibleEvents.length === 0 ? (
          <View style={{ alignItems: 'center', paddingTop: 60, gap: 12 }}>
            <Text style={{ fontSize: 40 }}>📅</Text>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>Niets gepland</Text>
            <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, textAlign: 'center' }}>
              Stuur "tandarts vrijdag 14u" via WhatsApp.
            </Text>
          </View>
        ) : visibleEvents.map(e => {
          const stream = streams.find(st => st.claude_key === e.calendar_stream);
          return (
            <View key={e.id} style={[{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.white, borderRadius: Radius.lg, padding: 16, marginBottom: 10, gap: 14, overflow: 'hidden' }, Shadow.card]}>
              {stream?.color && <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: stream.color }} />}
              <Text style={{ fontSize: 24, marginLeft: stream?.color ? 8 : 0 }}>{eventEmoji(e.title)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 16, color: colors.black }}>{e.title}</Text>
                {e.time && <Text style={{ fontFamily: 'Inter_300Light', fontSize: 13, color: colors.gray400, marginTop: 2 }}>{e.time}</Text>}
                {timePeriod === 'week' && e.date && (
                  <Text style={{ fontFamily: 'Inter_300Light', fontSize: 12, color: colors.gray400, marginTop: 1 }}>{sectionLabel(e.date)}</Text>
                )}
              </View>
              {stream && (
                <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: stream.color + '22' }}>
                  <Text style={{ fontSize: 11, color: stream.color, fontFamily: 'Inter_600SemiBold' }}>{stream.emoji}</Text>
                </View>
              )}
            </View>
          );
        })}
      </ScrollView>

      {/* Bottom fade */}
      <LinearGradient
        colors={[`${colors.offWhite}00`, colors.offWhite]}
        style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, pointerEvents: 'none' }}
      />
    </View>
  );
}

export default function AgendaTab() {
  const { settings } = useModuleSettings();
  if (settings.calendar_mode === 'lite') return <AgendaLite />;

  const { user }   = useUser();
  const { colors } = useTheme();
  const insets     = useSafeAreaInsets();
  const listRef    = useRef<FlatList<FlatItem>>(null);
  const monthsRef  = useRef<FlatList>(null);

  const [allSections, setAllSections]   = useState<Section[]>([]);
  const [timePeriod, setTimePeriod]     = useState<TimePeriod>('today');
  const [streamFilter, setStreamFilter] = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [refreshing, setRefreshing]       = useState(false);
  const [calPermission, setCalPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  const [calHidden, setCalHidden]         = useState(false);
  const [viewMode, setViewMode]         = useState<ViewMode>('list');
  const [selectedDate, setSelectedDate] = useState(TODAY);
  const [streams, setStreams]           = useState<CalendarStream[]>([]);

  const PANEL_COLLAPSED = 200;
  const PANEL_EXPANDED  = 440;
  const panelHeight     = useRef(new Animated.Value(PANEL_COLLAPSED)).current;
  const panelCurrent    = useRef(PANEL_COLLAPSED);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_, g) => {
        const next = Math.max(PANEL_COLLAPSED, Math.min(PANEL_EXPANDED, panelCurrent.current - g.dy));
        panelHeight.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const midpoint = (PANEL_COLLAPSED + PANEL_EXPANDED) / 2;
        const currentVal = panelCurrent.current - g.dy;
        const target = (g.vy < -0.3 || currentVal > midpoint) ? PANEL_EXPANDED : PANEL_COLLAPSED;
        panelCurrent.current = target;
        Animated.spring(panelHeight, { toValue: target, useNativeDriver: false, bounciness: 4 }).start();
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

  return (
    <View style={[s.container, { backgroundColor: colors.offWhite }]}>

      {/* ── Fixed header ─────────────────────────────────────────────────── */}
      <View>
        <View style={[s.banner, { paddingTop: insets.top + 36 }]}>
          <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
          <View style={s.bannerRow}>
            <Text style={s.bannerTitle}>Agenda</Text>
          </View>
          {viewMode === 'list' && (
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
          )}
        </View>

        {/* Time period pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
          {([['today', 'Vandaag'], ['tomorrow', 'Morgen'], ['thisweek', 'Deze week'], ['nextweek', 'Volgende week']] as [TimePeriod, string][]).map(([p, label]) => (
            <TouchableOpacity key={p} onPress={() => setTimePeriod(p)} style={{ paddingHorizontal: 16, paddingVertical: 9, borderRadius: 24, backgroundColor: timePeriod === p ? Colors.yellow : '#DDDCDC' }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111' }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Stream category chips */}
        {streams.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingBottom: 4 }}>
            <TouchableOpacity onPress={() => setStreamFilter(null)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: streamFilter === null ? Colors.yellow : '#DEDEDE' }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: '#111' }}>Alles</Text>
            </TouchableOpacity>
            {streams.map(st => (
              <TouchableOpacity key={st.id} onPress={() => setStreamFilter(streamFilter === st.claude_key ? null : st.claude_key)} style={{ paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: streamFilter === st.claude_key ? st.color : '#DEDEDE' }}>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 13, color: streamFilter === st.claude_key ? '#fff' : '#111' }}>{st.emoji} {st.name}</Text>
              </TouchableOpacity>
            ))}
            {phoneConnected && (
              <TouchableOpacity style={[s.chip, { backgroundColor: colors.white, borderColor: streamFilter === '__phone' ? colors.black : colors.gray200 }, streamFilter === '__phone' && { backgroundColor: colors.gray100 }]} onPress={() => setStreamFilter(streamFilter === '__phone' ? null : '__phone')}>
                <Text style={[s.pillText, { color: streamFilter === '__phone' ? colors.black : colors.gray400 }]}>📱 iPhone</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* View mode toggle */}
        <View style={[s.toggleWrap, { backgroundColor: colors.offWhite }]}>
          <TouchableOpacity style={s.tabTextBtn} onPress={() => setViewMode('list')}>
            <Text style={[s.tabTextLabel, { color: viewMode === 'list' ? colors.black : colors.gray400 }]}>Lijst</Text>
            {viewMode === 'list' && <View style={[s.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.tabTextBtn}
            onPress={() => {
              setViewMode('calendar');
              panelCurrent.current = PANEL_COLLAPSED;
              panelHeight.setValue(PANEL_COLLAPSED);
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
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchEvents(); }} tintColor={Colors.yellow} />}
          ListHeaderComponent={
            <View>
              {calPermission === 'unknown' && !calHidden && Platform.OS !== 'web' && (
                <TouchableOpacity style={[s.permBanner, { backgroundColor: colors.yellowLight }]} onPress={async () => { await fetchPhoneEvents(); setCalPermission('granted'); fetchEvents(); }}>
                  <Ionicons name="phone-portrait-outline" size={15} color={colors.black} />
                  <Text style={[s.permText, { color: colors.black }]}>Toon ook je iPhone-agenda</Text>
                  <Ionicons name="chevron-forward" size={13} color={colors.gray400} />
                </TouchableOpacity>
              )}
              {sections.length === 0 && (
                <View style={s.empty}>
                  <Text style={{ fontSize: 48, marginBottom: 16 }}>📅</Text>
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
            return (
              <View style={[s.cardWrap, isLast && { marginBottom: 4 }]}>
                <View style={[s.card, { backgroundColor: colors.white }, section.isPast && s.cardPast]}>
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
                </View>
              </View>
            );
          }}
        />
      )}

      {/* ── Calendar view ──────────────────────────────────────────────────── */}
      {/* Bottom fade — only in list mode; calendar has its own panel */}
      {viewMode === 'list' && (
        <LinearGradient
          colors={[`${colors.offWhite}00`, colors.offWhite]}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 100, pointerEvents: 'none' }}
        />
      )}

      {viewMode === 'calendar' && (
        <>
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
                onDayPress={setSelectedDate}
              />
            )}
          />
          <Animated.View style={[cal.panel, { height: panelHeight, backgroundColor: colors.white }]}>
            <View {...panResponder.panHandlers} style={cal.panelHandleArea}>
              <View style={[cal.panelHandle, { backgroundColor: colors.gray200 }]} />
              <Text style={[cal.panelTitle, { color: colors.black }]}>{sectionLabel(selectedDate)}</Text>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
              {selectedEvents.length === 0
                ? <Text style={[cal.noEvents, { color: colors.gray400 }]}>Geen afspraken</Text>
                : selectedEvents.map(e => {
                  const sc = e.source === 'sous-chef' ? streams.find(s => s.claude_key === e.calendar_stream)?.color : undefined;
                  return (
                    <View key={e.id} style={[cal.eventRow, { borderBottomColor: colors.gray100 }]}>
                      {sc && <View style={{ width: 4, height: '100%', borderRadius: 2, backgroundColor: sc, marginRight: 8 }} />}
                      <Text style={cal.eventEmoji}>{eventEmoji(e.title)}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={[cal.eventTitle, { color: colors.black }]}>{e.title}</Text>
                        {(e.time || e.source === 'phone') && (
                          <Text style={[cal.eventSub, { color: colors.gray400 }]}>
                            {[e.time, e.source === 'phone' ? 'iPhone-agenda' : null].filter(Boolean).join(' · ')}
                          </Text>
                        )}
                      </View>
                    </View>
                  );
                })
              }
            </ScrollView>
          </Animated.View>
        </>
      )}
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
  panel: {
    backgroundColor: Colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingBottom: 32,
    shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8,
  },
  panelHandleArea: { paddingTop: 12, paddingBottom: 8, alignItems: 'center' },
  panelHandle:     { width: 40, height: 5, borderRadius: 3, backgroundColor: Colors.gray200, marginBottom: 10 },
  panelTitle:      { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.black, alignSelf: 'flex-start' },
  noEvents:    { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400 },
  eventRow:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.gray100 },
  eventEmoji:  { fontSize: 20, marginRight: 12 },
  eventTitle:  { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: Colors.black },
  eventSub:    { fontFamily: 'Inter_400Regular', fontSize: 12, color: Colors.gray400, marginTop: 1 },
});

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.offWhite },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  banner:      { paddingHorizontal: 24, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden', marginBottom: 12 },
  bannerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 32, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase' },
  bannerStats: { flexDirection: 'row', gap: 10 },
  statTile: { paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#FFFFFF12', borderRadius: Radius.md, borderWidth: 1, borderColor: '#FFFFFF18', minWidth: 90 },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum: { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  icalBtn:     { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFFFFF12', borderRadius: Radius.pill, borderWidth: 1, borderColor: '#FFFFFF20' },
  icalBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.yellow },

  filterRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  pill:           { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 24, backgroundColor: '#E4E4E4' },
  chip:           { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 24, backgroundColor: '#E4E4E4' },
  pillActive:     { backgroundColor: Colors.yellow },
  pillText:       { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#222' },
  pillTextActive: { color: '#111' },
  unlinkBtn: { padding: 7 },

  toggleWrap: { flexDirection: 'row', paddingHorizontal: 24, paddingBottom: 12, gap: 20 },
  tabTextBtn: { alignItems: 'center', paddingBottom: 8 },
  tabTextLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.3 },
  tabTextUnderline: { height: 3, width: '100%', borderRadius: 2, marginTop: 4 },

  permBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.yellowLight, marginHorizontal: 16, marginBottom: 8, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11 },
  permText:   { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.black },
  pastToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginBottom: 4 },
  pastToggleText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.gray400 },

  sectionHeader:     { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 8, backgroundColor: Colors.offWhite },
  sectionHeaderPast: { opacity: 0.5 },
  dot:               { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.gray200 },
  dotToday:          { backgroundColor: Colors.yellow, width: 8, height: 8, borderRadius: 4 },
  sectionLabel:      { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.gray400, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionLabelToday: { color: Colors.yellow },
  sectionLabelPast:  { color: Colors.gray400 },

  cardWrap: { paddingHorizontal: 16, paddingBottom: 8 },
  card:     { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.card },
  cardPast: { opacity: 0.5 },
  accent:        { width: 4, alignSelf: 'stretch' },
  accentDefault: { backgroundColor: Colors.gray200 },
  accentToday:   { backgroundColor: Colors.yellow },
  accentPhone:   { backgroundColor: Colors.gray200 },
  emoji:     { fontSize: 22, marginHorizontal: 14 },
  cardBody:  { flex: 1, paddingVertical: 14, paddingRight: 8 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: Colors.black, marginBottom: 5 },
  muted:     { color: Colors.gray400 },
  metaRow:   { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  tag:       { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: Colors.gray100, borderRadius: 5, paddingHorizontal: 7, paddingVertical: 2 },
  tagText:   { fontFamily: 'Inter_400Regular', fontSize: 10, color: Colors.gray600 },
  countLabel:{ fontFamily: 'Inter_300Light', fontSize: 12, color: Colors.gray400, paddingRight: 14 },

  empty:     { alignItems: 'center', paddingTop: 60 },
  emptyTitle:{ fontFamily: 'Inter_700Bold', fontSize: 20, color: Colors.black, marginBottom: 8 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400, textAlign: 'center' },
});

