'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, Animated, Pressable,
  SafeAreaView, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { Colors } from '@/constants/Design';

// ── Constants ──────────────────────────────────────────────────────────────────

const MORNING_KEY = 'morning_shown_date';
const MORNING_LISTS_KEY = 'morning_list_ids';

// Keyed by ISO 3166-1 alpha-2 country code (lowercase)
const COUNTRY_GREETINGS: Record<string, { text: string; flag: string }> = {
  nl: { text: 'Goedemorgen',      flag: '🇳🇱' },
  be: { text: 'Goedemorgen',      flag: '🇧🇪' },
  de: { text: 'Guten Morgen',     flag: '🇩🇪' },
  at: { text: 'Guten Morgen',     flag: '🇦🇹' },
  ch: { text: 'Guten Morgen',     flag: '🇨🇭' },
  fr: { text: 'Bonjour',          flag: '🇫🇷' },
  es: { text: 'Buenos días',      flag: '🇪🇸' },
  mx: { text: 'Buenos días',      flag: '🇲🇽' },
  it: { text: 'Buongiorno',       flag: '🇮🇹' },
  pt: { text: 'Bom dia',          flag: '🇵🇹' },
  br: { text: 'Bom dia',          flag: '🇧🇷' },
  se: { text: 'God morgon',       flag: '🇸🇪' },
  dk: { text: 'God morgen',       flag: '🇩🇰' },
  no: { text: 'God morgen',       flag: '🇳🇴' },
  fi: { text: 'Hyvää huomenta',   flag: '🇫🇮' },
  pl: { text: 'Dzień dobry',      flag: '🇵🇱' },
  tr: { text: 'Günaydın',         flag: '🇹🇷' },
  jp: { text: 'おはようございます', flag: '🇯🇵' },
  kr: { text: '좋은 아침',         flag: '🇰🇷' },
  cn: { text: '早上好',            flag: '🇨🇳' },
  sa: { text: 'صباح الخير',       flag: '🇸🇦' },
  ae: { text: 'صباح الخير',       flag: '🇦🇪' },
  us: { text: 'Good morning',     flag: '🇺🇸' },
  gb: { text: 'Good morning',     flag: '🇬🇧' },
  au: { text: 'Good morning',     flag: '🇦🇺' },
  ca: { text: 'Good morning',     flag: '🇨🇦' },
  za: { text: 'Good morning',     flag: '🇿🇦' },
  gr: { text: 'Καλημέρα',         flag: '🇬🇷' },
  ru: { text: 'Доброе утро',      flag: '🇷🇺' },
  th: { text: 'สวัสดีตอนเช้า',    flag: '🇹🇭' },
  id: { text: 'Selamat pagi',     flag: '🇮🇩' },
};

const QUOTES = [
  { text: 'The secret of getting ahead is getting started.', author: 'Mark Twain' },
  { text: "It always seems impossible until it's done.", author: 'Nelson Mandela' },
  { text: "Believe you can and you're halfway there.", author: 'Theodore Roosevelt' },
  { text: "Don't watch the clock; do what it does. Keep going.", author: 'Sam Levenson' },
  { text: 'The best time to plant a tree was 20 years ago. The second best is now.', author: 'Chinese Proverb' },
  { text: 'Success is not final, failure is not fatal — courage to continue counts.', author: 'Winston Churchill' },
  { text: 'In the middle of every difficulty lies opportunity.', author: 'Albert Einstein' },
  { text: 'The only way to do great work is to love what you do.', author: 'Steve Jobs' },
  { text: "You miss 100% of the shots you don't take.", author: 'Wayne Gretzky' },
  { text: "Whether you think you can or you think you can't, you're right.", author: 'Henry Ford' },
  { text: 'The future belongs to those who believe in the beauty of their dreams.', author: 'Eleanor Roosevelt' },
  { text: 'Happiness comes from your own actions.', author: 'Dalai Lama' },
  { text: 'Keep your face toward the sunshine, and shadows will fall behind you.', author: 'Walt Whitman' },
  { text: 'Act as if what you do makes a difference. It does.', author: 'William James' },
  { text: "It's not whether you get knocked down, it's whether you get up.", author: 'Vince Lombardi' },
  { text: 'Quality is not an act, it is a habit.', author: 'Aristotle' },
  { text: 'Life is what happens when you\'re busy making other plans.', author: 'John Lennon' },
  { text: 'Do what you can, with what you have, where you are.', author: 'Theodore Roosevelt' },
  { text: 'Strive not to be a success, but rather to be of value.', author: 'Albert Einstein' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'We are what we repeatedly do. Excellence is a habit.', author: 'Aristotle' },
  { text: 'The journey of a thousand miles begins with one step.', author: 'Lao Tzu' },
  { text: 'Your time is limited, so don\'t waste it living someone else\'s life.', author: 'Steve Jobs' },
  { text: 'First, solve the problem. Then, write the code.', author: 'John Johnson' },
  { text: 'An unexamined life is not worth living.', author: 'Socrates' },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type Event = { id: string; title: string; time?: string | null; date?: string };
type ListGroup = { listName: string; listEmoji: string; items: string[] };

async function detectCountryGreeting() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('https://ipapi.co/json/', { signal: controller.signal });
    clearTimeout(timeout);
    const json = await res.json();
    const code = (json.country_code ?? '').toLowerCase();
    return COUNTRY_GREETINGS[code] ?? COUNTRY_GREETINGS['nl'];
  } catch {
    return COUNTRY_GREETINGS['nl'];
  }
}

function formatTime(time: string | null | undefined) {
  if (!time) return null;
  return time.slice(0, 5);
}

// ── MorningScreen ──────────────────────────────────────────────────────────────

export function MorningScreen() {
  const { user } = useUser();
  const insets = useSafeAreaInsets();

  const [visible, setVisible]       = useState(false);
  const [step, setStep]             = useState(0);
  const [events, setEvents]         = useState<Event[]>([]);
  const [listGroups, setListGroups] = useState<ListGroup[]>([]);
  const [quote, setQuote]           = useState(QUOTES[0]);
  const [greeting, setGreeting]     = useState(COUNTRY_GREETINGS['nl']);

  const masterOpacity = useRef(new Animated.Value(1)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    if (!user || user.id === 'dev') return;

    const today = new Date().toISOString().split('T')[0];

    // Today's events
    const { data: evtData } = await supabase
      .from('events')
      .select('id, title, time')
      .eq('user_id', user.id)
      .eq('date', today)
      .order('time', { ascending: true, nullsFirst: false });
    setEvents((evtData ?? []) as Event[]);

    // Morning lists
    const storedIds = await AsyncStorage.getItem(MORNING_LISTS_KEY);
    let listIds: string[] = [];

    if (storedIds !== null) {
      listIds = JSON.parse(storedIds);
    } else {
      // Default: find the boodschappenlijst
      const { data: allLists } = await supabase
        .from('lists')
        .select('id, name')
        .eq('user_id', user.id);
      const boodschappen = (allLists ?? []).find(l =>
        l.name.toLowerCase().includes('boodschappen') ||
        l.name.toLowerCase().includes('groceries') ||
        l.name.toLowerCase().includes('supermarkt')
      );
      if (boodschappen) {
        listIds = [boodschappen.id];
        await AsyncStorage.setItem(MORNING_LISTS_KEY, JSON.stringify(listIds));
      }
    }

    if (listIds.length > 0) {
      const { data: listsData } = await supabase
        .from('lists')
        .select('id, name, emoji')
        .in('id', listIds);

      const { data: itemsData } = await supabase
        .from('list_items')
        .select('text, list_id')
        .in('list_id', listIds)
        .eq('checked', false)
        .order('created_at', { ascending: true });

      const groups: ListGroup[] = (listsData ?? []).map(l => ({
        listName: l.name,
        listEmoji: l.emoji ?? '📝',
        items: (itemsData ?? []).filter(i => i.list_id === l.id).map(i => i.text),
      })).filter(g => g.items.length > 0);

      setListGroups(groups);
    }

    // IP-based greeting
    detectCountryGreeting().then(setGreeting);

    // Random quote
    setQuote(QUOTES[Math.floor(Math.random() * QUOTES.length)]);
  }, [user]);

  useEffect(() => {
    if (!user || user.id === 'dev') return;

    const now = new Date();
    const today = now.toISOString().split('T')[0];

    AsyncStorage.getItem(MORNING_KEY).then(async (lastShown) => {
      const hour = now.getHours();
      if (lastShown === today) return;
      if (hour < 6 || hour >= 12) return;
      await load();
      setVisible(true);
      await AsyncStorage.setItem(MORNING_KEY, today);
    });
  }, [user, load]);

  // How many screens to show
  const hasEvents    = events.length > 0;
  const hasLists     = listGroups.length > 0;
  const useOneScreen = !hasEvents || !hasLists; // combine if one side empty
  const totalScreens = useOneScreen ? 1 : 2;

  function crossfadeTo(nextStep: number) {
    Animated.timing(screenOpacity, { toValue: 0, duration: 180, useNativeDriver: true }).start(() => {
      setStep(nextStep);
      Animated.timing(screenOpacity, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }

  function handleTap() {
    if (step < totalScreens - 1) {
      crossfadeTo(step + 1);
    } else {
      Animated.timing(masterOpacity, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setVisible(false);
      });
    }
  }

  if (!visible) return null;

  const showAgenda = step === 0 || useOneScreen;
  const showLists  = step === 1 || useOneScreen;

  const dots = totalScreens > 1 ? (
    <View style={styles.dots}>
      {[0, 1].map(i => (
        <View key={i} style={[styles.dot, step === i && styles.dotActive]} />
      ))}
    </View>
  ) : null;

  return (
    <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: masterOpacity, zIndex: 999 }]}>
      <StatusBar barStyle="dark-content" />
      <LinearGradient
        colors={['#FFFBEF', '#FFF3C4', '#FFE57A']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />

      <Pressable style={StyleSheet.absoluteFillObject} onPress={handleTap}>
        <SafeAreaView style={{ flex: 1 }}>
          <Animated.View style={[styles.content, { opacity: screenOpacity }]}>

            {/* ── Greeting ──────────────────────────────────────────── */}
            <View style={[styles.header, { marginTop: insets.top + 8 }]}>
              <Text style={styles.flag}>{greeting.flag}</Text>
              <Text style={styles.greetText}>{greeting.text}</Text>
              <Text style={styles.dateText}>
                {new Date().toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' })}
              </Text>
            </View>

            {/* ── Agenda (screen 1 or combined) ─────────────────────── */}
            {showAgenda && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="calendar" size={16} color="#92700A" />
                  <Text style={styles.sectionLabel}>Vandaag op de planning</Text>
                </View>
                {events.length === 0 ? (
                  <Text style={styles.emptyText}>Niets gepland vandaag 🎉</Text>
                ) : (
                  events.slice(0, 6).map((e) => (
                    <View key={e.id} style={styles.eventRow}>
                      <View style={styles.eventDot} />
                      <Text style={styles.eventTime}>{formatTime(e.time) ?? '  '}</Text>
                      <Text style={styles.eventTitle} numberOfLines={1}>{e.title}</Text>
                    </View>
                  ))
                )}
                {events.length > 6 && (
                  <Text style={styles.moreText}>+{events.length - 6} meer</Text>
                )}
              </View>
            )}

            {/* ── Lists (screen 2 or combined) ──────────────────────── */}
            {showLists && listGroups.length > 0 && (
              <View style={styles.section}>
                {listGroups.map(group => (
                  <View key={group.listName}>
                    <View style={styles.sectionHeader}>
                      <Text style={styles.listEmoji}>{group.listEmoji}</Text>
                      <Text style={styles.sectionLabel}>{group.listName}</Text>
                    </View>
                    {group.items.slice(0, 5).map((item, idx) => (
                      <View key={idx} style={styles.listItemRow}>
                        <View style={styles.checkbox} />
                        <Text style={styles.listItemText} numberOfLines={1}>{item}</Text>
                      </View>
                    ))}
                    {group.items.length > 5 && (
                      <Text style={styles.moreText}>+{group.items.length - 5} meer</Text>
                    )}
                  </View>
                ))}
              </View>
            )}

            {/* ── Quote (screen 2 or combined when lists empty) ─────── */}
            {(step === totalScreens - 1 || (useOneScreen && !hasLists)) && (
              <View style={styles.quoteWrap}>
                <Text style={styles.quoteText}>"{quote.text}"</Text>
                <Text style={styles.quoteAuthor}>— {quote.author}</Text>
              </View>
            )}

            {/* ── Footer ────────────────────────────────────────────── */}
            <View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
              {dots}
              <Text style={styles.tapHint}>
                {step < totalScreens - 1 ? 'Tik voor verder →' : 'Tik om te beginnen'}
              </Text>
            </View>

          </Animated.View>
        </SafeAreaView>
      </Pressable>
    </Animated.View>
  );
}

// ── Settings helper (used in Instellingen) ────────────────────────────────────

export async function getMorningListIds(): Promise<string[]> {
  const stored = await AsyncStorage.getItem(MORNING_LISTS_KEY);
  return stored ? JSON.parse(stored) : [];
}

export async function setMorningListIds(ids: string[]): Promise<void> {
  await AsyncStorage.setItem(MORNING_LISTS_KEY, JSON.stringify(ids));
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  content: {
    flex: 1,
    paddingHorizontal: 28,
  },
  header: {
    alignItems: 'center',
    marginBottom: 28,
  },
  flag: {
    fontSize: 48,
    marginBottom: 8,
  },
  greetText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 34,
    color: '#1A0F00',
    letterSpacing: -0.5,
    textAlign: 'center',
  },
  dateText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#92700A',
    marginTop: 4,
    textAlign: 'center',
  },
  section: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderRadius: 20,
    padding: 18,
    marginBottom: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  sectionLabel: {
    fontFamily: 'Inter_700Bold',
    fontSize: 13,
    color: '#92700A',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  listEmoji: {
    fontSize: 14,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#92700A',
    textAlign: 'center',
    paddingVertical: 4,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  eventDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: Colors.yellow,
  },
  eventTime: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#5A3C00',
    width: 38,
  },
  eventTitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#1A0F00',
    flex: 1,
  },
  listItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#C4950A',
  },
  listItemText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    color: '#1A0F00',
    flex: 1,
  },
  moreText: {
    fontFamily: 'Inter_300Light',
    fontSize: 13,
    color: '#92700A',
    marginTop: 2,
  },
  quoteWrap: {
    marginTop: 4,
    paddingHorizontal: 4,
  },
  quoteText: {
    fontFamily: 'Inter_300Light',
    fontSize: 15,
    color: '#5A3C00',
    lineHeight: 22,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  quoteAuthor: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 13,
    color: '#92700A',
    textAlign: 'center',
    marginTop: 8,
  },
  footer: {
    marginTop: 'auto',
    alignItems: 'center',
    gap: 10,
  },
  dots: {
    flexDirection: 'row',
    gap: 6,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(146,112,10,0.3)',
  },
  dotActive: {
    backgroundColor: '#92700A',
    width: 20,
  },
  tapHint: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: '#92700A',
  },
});
