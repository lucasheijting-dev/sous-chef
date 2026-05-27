import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Animated,
  LayoutAnimation,
  Pressable,
  Platform,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  ScrollView,
  SafeAreaView,
  Linking,
  Image,
  Alert,
  ActivityIndicator,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { List, Note } from '@/lib/types';
import { Colors, Shadow, Radius, TAB_BAR_CLEARANCE } from '@/constants/Design';
import { SkeletonListCard } from '@/components/SkeletonCard';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BOT_NUMBER = '31684965318';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

function getGreeting(): string {
  const h = new Date().getHours();
  const day = new Date().getDay(); // 0=Sun, 6=Sat
  const weekend = day === 0 || day === 6;
  if (h >= 5  && h < 12) return weekend ? 'Goed weekend' : 'Goedemorgen';
  if (h >= 12 && h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

const TILE_ACCENTS  = ['#FCC10C', '#1A1A1A', '#E8734A', '#4A6FA5'];
const TILE_TEXT_FG  = ['#0A0A0A', '#FFFFFF',  '#FFFFFF',  '#FFFFFF'];

// ── Bottom Sheet ───────────────────────────────────────────────────────────────

function ConfirmSheet({
  visible,
  title,
  subtitle,
  destructiveLabel,
  onConfirm,
  onCancel,
}: {
  visible: boolean;
  title: string;
  subtitle: string;
  destructiveLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const slideAnim = useRef(new Animated.Value(300)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 0, duration: 160, useNativeDriver: true }),
        Animated.timing(slideAnim, { toValue: 300, duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Modal transparent visible={visible} animationType="none" onRequestClose={onCancel}>
      <Animated.View style={[sheetStyles.overlay, { opacity: fadeAnim }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onCancel} />
        <Animated.View style={[sheetStyles.sheet, { backgroundColor: colors.white, paddingBottom: insets.bottom > 0 ? insets.bottom : 24, transform: [{ translateY: slideAnim }] }]}>
          <View style={sheetStyles.handle} />
          <Text style={[sheetStyles.title, { color: colors.black }]}>{title}</Text>
          <Text style={[sheetStyles.subtitle, { color: colors.gray400 }]}>{subtitle}</Text>
          <TouchableOpacity style={[sheetStyles.destructiveBtn]} onPress={onConfirm} activeOpacity={0.85}>
            <Text style={sheetStyles.destructiveBtnText}>{destructiveLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[sheetStyles.cancelBtn, { backgroundColor: colors.gray100 }]} onPress={onCancel} activeOpacity={0.8}>
            <Text style={[sheetStyles.cancelBtnText, { color: colors.black }]}>Annuleer</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const sheetStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingTop: 14, gap: 10 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.gray200, alignSelf: 'center', marginBottom: 16 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center', marginBottom: 2 },
  subtitle: { fontFamily: 'Inter_300Light', fontSize: 14, textAlign: 'center', marginBottom: 8 },
  destructiveBtn: { backgroundColor: '#EF4444', borderRadius: Radius.pill, paddingVertical: 15, alignItems: 'center' },
  destructiveBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.white },
  cancelBtn: { borderRadius: Radius.pill, paddingVertical: 15, alignItems: 'center' },
  cancelBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
});

// ── List Card ──────────────────────────────────────────────────────────────────

function AnimatedCard({
  item,
  index,
  onPress,
  onDeleteConfirm,
  onLongPress,
  showHint,
  onHintComplete,
}: {
  item: List & { item_count: number; open_count: number };
  index: number;
  onPress: () => void;
  onDeleteConfirm: () => void;
  onLongPress?: () => void;
  colors: any;
  showHint?: boolean;
  onHintComplete?: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const hintX = useRef(new Animated.Value(0)).current;
  const swipeRef = useRef<Swipeable>(null);

  const bg = TILE_ACCENTS[index % TILE_ACCENTS.length];
  const fg = TILE_TEXT_FG[index % TILE_TEXT_FG.length];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, delay: index * 40, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, delay: index * 40, useNativeDriver: true }),
    ]).start(() => {
      if (showHint) {
        setTimeout(() => {
          Animated.sequence([
            Animated.timing(hintX, { toValue: -22, duration: 220, useNativeDriver: true }),
            Animated.spring(hintX, { toValue: 0, useNativeDriver: true, damping: 12, stiffness: 180 }),
          ]).start(() => onHintComplete?.());
        }, 400);
      }
    });
  }, []);

  const typeLabel = item.list_type === 'links' ? 'Links' : item.list_type === 'tips' ? 'Tips' : null;
  const totalCount = item.item_count;
  const openCount = item.open_count;
  const allDone = totalCount > 0 && openCount === 0;
  const progress = totalCount > 0 ? (totalCount - openCount) / totalCount : 0;

  const renderLeftActions = (_prog: Animated.AnimatedInterpolation<number>, drag: Animated.AnimatedInterpolation<number>) => {
    const iconScale = drag.interpolate({ inputRange: [0, 80], outputRange: [0.7, 1], extrapolate: 'clamp' });
    return (
      <TouchableOpacity
        style={cardStyles.deleteAction}
        onPress={() => { swipeRef.current?.close(); onDeleteConfirm(); }}
        activeOpacity={0.8}
      >
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Ionicons name="trash-outline" size={22} color={Colors.white} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Animated.View style={[styles.tileWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { translateX: hintX }, { scale }] }]}>
      <Swipeable ref={swipeRef} renderLeftActions={renderLeftActions} leftThreshold={60} overshootLeft={false}>
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
          onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
          style={[styles.tile, { backgroundColor: bg }]}
        >
          <Text style={styles.tileEmoji}>{item.emoji || '📝'}</Text>
          <View style={styles.tileBottom}>
            <Text style={[styles.tileName, { color: fg }]} numberOfLines={2}>{item.name}</Text>
            <View style={styles.tileCountRow}>
              {totalCount > 0 ? (
                allDone ? (
                  <Text style={[styles.tileCount, { color: '#4CAF50', opacity: 1, fontFamily: 'Inter_600SemiBold' }]}>✓ Klaar</Text>
                ) : (
                  <Text style={[styles.tileCount, { color: fg, opacity: 0.72 }]}>{totalCount - openCount}/{totalCount}</Text>
                )
              ) : (
                <Text style={[styles.tileCount, { color: fg, opacity: 0.65 }]}>Leeg</Text>
              )}
              {typeLabel && (
                <View style={[styles.typeBadge, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                  <Text style={[styles.typeBadgeText, { color: fg }]}>{typeLabel}</Text>
                </View>
              )}
            </View>
          </View>
          {totalCount > 0 && (
            <View style={styles.tileProgressBg}>
              <View style={[styles.tileProgressFill, { width: `${progress * 100}%` as any, backgroundColor: allDone ? '#4CAF50' : Colors.yellow }]} />
            </View>
          )}
        </Pressable>
      </Swipeable>
    </Animated.View>
  );
}

const cardStyles = StyleSheet.create({
  deleteAction: {
    backgroundColor: '#EF4444',
    borderRadius: Radius.xl,
    width: 72,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 0,
    marginRight: 8,
  },
});

// ── Notes ──────────────────────────────────────────────────────────────────────

function getCardStyles(isDark: boolean) {
  return [
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: Colors.black, title: Colors.yellow, body: '#888', date: '#444' },
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: isDark ? '#242426' : '#F5F5F0', title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
  ];
}

function NoteCard({ item, index, onPress, isDark }: { item: Note; index: number; onPress: () => void; isDark: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const CARD_STYLES = getCardStyles(isDark);
  const style = CARD_STYLES[index % CARD_STYLES.length];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, delay: (index % 4) * 50, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, delay: (index % 4) * 50, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        style={[styles.noteCard, { backgroundColor: style.bg }]}
      >
        <Text style={[styles.noteCardTitle, { color: style.title }]} numberOfLines={2}>
          {item.title || item.body.slice(0, 40)}
        </Text>
        <Text style={[styles.noteCardBody, { color: style.body }]} numberOfLines={5}>{item.body}</Text>
        <View style={styles.noteCardFooter}>
          <Text style={[styles.noteCardDate, { color: style.date }]}>
            {(() => {
              const diff = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000);
              if (diff === 0) return 'Vandaag';
              if (diff === 1) return 'Gisteren';
              if (diff < 7) return `${diff} dg geleden`;
              return new Date(item.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
            })()}
          </Text>
          <Ionicons name="open-outline" size={12} color={style.date} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Getting Started Banner ─────────────────────────────────────────────────────

function GettingStartedBanner({ userId, onDismiss, colors }: { userId: string | null; onDismiss: () => void; colors: any }) {
  const [messageSent, setMessageSent] = useState(false);
  const [caldavConnected, setCaldavConnected] = useState(false);

  useEffect(() => {
    if (!userId || userId === 'dev') return;
    supabase
      .from('users')
      .select('caldav_username, message_count')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (!data) return;
        setMessageSent((data.message_count ?? 0) > 0);
        setCaldavConnected(!!data.caldav_username);
      });
  }, [userId]);

  const allDone = messageSent && caldavConnected;

  const quickActions = [
    {
      icon: 'chatbubble-outline' as const,
      label: 'Stuur je eerste bericht',
      done: messageSent,
      action: () => Linking.openURL(`whatsapp://send?phone=${BOT_NUMBER}&text=Hoi`),
    },
    {
      icon: 'calendar-outline' as const,
      label: 'Koppel iPhone Agenda',
      done: caldavConnected,
      action: () => {
        if (!userId || userId === 'dev') return;
        Linking.openURL(`${API_BASE}/calendar-profile?userId=${userId}`);
      },
    },
  ];

  return (
    <View style={[styles.gettingStartedCard, { backgroundColor: colors.white }]}>
      <View style={styles.gettingStartedHeader}>
        <Text style={[styles.gettingStartedTitle, { color: colors.black }]}>Aan de slag</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={18} color={colors.gray400} />
        </TouchableOpacity>
      </View>
      {quickActions.map((action, i) => (
        <TouchableOpacity
          key={i}
          onPress={action.done ? undefined : action.action}
          activeOpacity={action.done ? 1 : 0.7}
          style={[styles.quickActionRow, action.done && { opacity: 0.5 }]}
          disabled={action.done}
        >
          <View style={[styles.quickActionIcon, { backgroundColor: action.done ? colors.gray100 : colors.gray100 }]}>
            <Ionicons
              name={action.done ? 'checkmark-circle' : action.icon}
              size={16}
              color={action.done ? '#4CAF50' : Colors.yellow}
            />
          </View>
          <Text style={[styles.quickActionLabel, { color: colors.black, textDecorationLine: action.done ? 'line-through' : 'none' }]}>
            {action.label}
          </Text>
          {!action.done && <Ionicons name="chevron-forward" size={14} color={colors.gray400} />}
        </TouchableOpacity>
      ))}
      {allDone && (
        <TouchableOpacity onPress={onDismiss} style={styles.allDoneRow}>
          <Text style={[styles.allDoneText, { color: colors.gray400 }]}>Alles klaar — sluiten</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ── Sort Toggle ────────────────────────────────────────────────────────────────

type SortMode = 'recent' | 'az' | 'complete';

function SortToggle({ value, onChange, colors }: { value: SortMode; onChange: (v: SortMode) => void; colors: any }) {
  const options: { key: SortMode; label: string }[] = [
    { key: 'recent', label: 'Recent' },
    { key: 'az', label: 'A-Z' },
    { key: 'complete', label: 'Compleet' },
  ];
  return (
    <View style={sortStyles.row}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt.key}
          onPress={() => onChange(opt.key)}
          style={[sortStyles.pill, { backgroundColor: value === opt.key ? Colors.yellow : colors.gray200 }]}
          activeOpacity={0.75}
        >
          <Text style={[sortStyles.pillText, { color: value === opt.key ? Colors.black : colors.gray600 }]}>{opt.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const sortStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, paddingTop: 20, paddingBottom: 20 },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: Radius.pill },
  pillText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
});

// ── Main ───────────────────────────────────────────────────────────────────────

type Tab = 'lists' | 'notes' | 'receipts';

type Receipt = {
  id: string; store: string | null; date: string | null; total: number | null;
  currency: string; items: any[]; category: string | null;
  description: string | null; image_url: string | null; created_at: string;
  receipt_category_id: string | null;
};

type ReceiptCategory = {
  id: string; name: string; emoji: string; color: string;
};

const RECEIPT_EMOJI: Record<string, string> = {
  supermarkt: '🛒', restaurant: '🍽️', kleding: '👕', benzine: '⛽', apotheek: '💊', overig: '🧾',
};

const CAT_COLORS = ['#4A90D8','#E8734A','#4ECDC4','#9B59B6','#E74C3C','#27AE60','#F39C12','#1A1A1A'];

const CURRENCY_SYMBOLS: Record<string, string> = { EUR: '€', USD: '$', GBP: '£', SEK: 'kr', NOK: 'kr', DKK: 'kr', CHF: 'CHF', JPY: '¥', CNY: '¥', AUD: 'A$', CAD: 'C$' };
function formatAmount(total: number | null, currency = 'EUR') {
  if (total == null) return 'onbekend';
  const cur = (currency ?? 'EUR').toUpperCase();
  const sym = CURRENCY_SYMBOLS[cur] ?? cur;
  const after = ['SEK', 'NOK', 'DKK'].includes(cur);
  return after ? `${total.toFixed(2)} ${sym}` : `${sym}${total.toFixed(2)}`;
}

function formatReceiptDate(iso: string | null) {
  if (!iso) return '';
  try { return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}

export default function LijstenTab() {
  const { user } = useUser();
  const { colors, isDark } = useTheme();
  const { settings, updateSetting } = useModuleSettings();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>('lists');

  useEffect(() => {
    AsyncStorage.getItem('home_active_tab').then(v => {
      if (v === 'lists' || v === 'notes' || v === 'receipts') setActiveTab(v as Tab);
    });
  }, []);

  function switchTab(tab: Tab) {
    setActiveTab(tab);
    AsyncStorage.setItem('home_active_tab', tab);
  }
  const [lists, setLists] = useState<(List & { item_count: number; open_count: number })[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [receiptCats, setReceiptCats] = useState<ReceiptCategory[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<string | null>(null);
  const [catModalVisible, setCatModalVisible] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatEmoji, setNewCatEmoji] = useState('📁');
  const [newCatColor, setNewCatColor] = useState(CAT_COLORS[0]);
  const [assignModalReceipt, setAssignModalReceipt] = useState<Receipt | null>(null);
  const [detailReceipt, setDetailReceipt] = useState<Receipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fetchError, setFetchError] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [deleteSheet, setDeleteSheet] = useState<{ listId: string; listName: string } | null>(null);
  const [pendingListDelete, setPendingListDelete] = useState<{ listId: string; listName: string; items: typeof lists } | null>(null);
  const [listUndoVisible, setListUndoVisible] = useState(false);
  const listUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [swipeHintDone, setSwipeHintDone] = useState(true);
  const [peekTarget, setPeekTarget] = useState<{ list: (typeof lists)[0]; x: number; y: number } | null>(null);
  const [peekItems, setPeekItems] = useState<{ id: string; text: string; checked: boolean }[]>([]);
  const [reorderModalVisible, setReorderModalVisible] = useState(false);
  const [reorderList, setReorderList] = useState<typeof lists>([]);
  const [newListModalVisible, setNewListModalVisible] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListCreating, setNewListCreating] = useState(false);

  const scrollY = useRef(new Animated.Value(0)).current;
  const emptyBreath = useRef(new Animated.Value(1)).current;
  const breathLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const undoSlide = useRef(new Animated.Value(60)).current;
  const undoOpacity = useRef(new Animated.Value(0)).current;
  const fetchListsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showBanner = settings.onboarding_done && !settings.getting_started_dismissed;

  const fetchLists = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); setRefreshing(false); return; }
    try {
      const listsRes = await supabase
        .from('lists')
        .select('id, name, emoji, sort_order, list_type, list_items(checked)')
        .eq('user_id', user.id)
        .order('sort_order', { ascending: true });
      if (listsRes.data) {
        setLists(listsRes.data.map((l: any) => {
          const items: any[] = Array.isArray(l.list_items) ? l.list_items : [];
          const totalCount = items.length;
          const openCount = items.filter((li: any) => !li.checked).length;
          return { ...l, item_count: totalCount, open_count: openCount };
        }));
        setFetchError(false);
      } else {
        setFetchError(true);
      }
    } catch {
      setFetchError(true);
    }
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  const fetchNotes = useCallback(async () => {
    if (!user || user.id === 'dev') return;
    const { data } = await supabase.from('notes').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (data) setNotes(data);
  }, [user]);

  useEffect(() => {
    fetchLists();
    fetchNotes();
    if (!user || user.id === 'dev') return;
    const ch = supabase.channel('lists-notes-ch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'lists', filter: `user_id=eq.${user.id}` }, fetchLists)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, () => {
        if (fetchListsDebounceRef.current) clearTimeout(fetchListsDebounceRef.current);
        fetchListsDebounceRef.current = setTimeout(fetchLists, 400);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, fetchNotes)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, fetchLists, fetchNotes]);

  useEffect(() => {
    AsyncStorage.getItem('swipe_hint_done').then(v => {
      if (!v) setSwipeHintDone(false);
    });
  }, []);

  const filteredNotes = notes.filter(n =>
    n.title?.toLowerCase().includes(search.toLowerCase()) ||
    n.body.toLowerCase().includes(search.toLowerCase())
  );

  const sortedLists = [...lists].sort((a, b) => {
    if (sortMode === 'az') return a.name.localeCompare(b.name, 'nl');
    if (sortMode === 'complete') {
      const pa = a.item_count > 0 ? (a.item_count - a.open_count) / a.item_count : 0;
      const pb = b.item_count > 0 ? (b.item_count - b.open_count) / b.item_count : 0;
      return pb - pa;
    }
    // Sink fully-done lists to the bottom
    const aDone = a.item_count > 0 && a.open_count === 0 ? 1 : 0;
    const bDone = b.item_count > 0 && b.open_count === 0 ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const activeLists = sortedLists.filter(l => !(l.item_count > 0 && l.open_count === 0));
  const doneLists   = sortedLists.filter(l => l.item_count > 0 && l.open_count === 0);

  const fetchReceipts = useCallback(async () => {
    if (!user || user.id === 'dev') return;
    try {
      const [rRes, cRes] = await Promise.all([
        fetch(`${API_BASE}/receipts/${user.id}`),
        fetch(`${API_BASE}/receipt-categories/${user.id}`),
      ]);
      const [rData, cData] = await Promise.all([rRes.json(), cRes.json()]);
      if (Array.isArray(rData)) setReceipts(rData);
      if (Array.isArray(cData)) setReceiptCats(cData);
    } catch {}
  }, [user]);

  async function createReceiptCat() {
    if (!newCatName.trim() || !user) return;
    const emoji = [...newCatEmoji][0] ?? '📁';
    try {
      const res = await fetch(`${API_BASE}/receipt-categories/${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newCatName.trim(), emoji, color: newCatColor }),
      });
      const cat = await res.json();
      if (cat.id) {
        setReceiptCats(prev => [...prev, cat]);
        setCatModalVisible(false);
      } else {
        Alert.alert('Fout', cat.error ?? 'Kon categorie niet opslaan.');
      }
    } catch (e: any) {
      Alert.alert('Fout', e.message);
    }
  }

  async function assignReceiptCat(receiptId: string, categoryId: string | null) {
    if (!user) return;
    await fetch(`${API_BASE}/receipt-categories/${user.id}/assign`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receipt_id: receiptId, category_id: categoryId }),
    });
    setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, receipt_category_id: categoryId } : r));
    setAssignModalReceipt(null);
  }

  function deleteList(listId: string, listName: string) {
    const snapshot = lists;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setLists(prev => prev.filter(l => l.id !== listId));
    setDeleteSheet(null);
    setPendingListDelete({ listId, listName, items: snapshot });
    setListUndoVisible(true);
    undoSlide.setValue(60);
    undoOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(undoSlide, { toValue: 0, useNativeDriver: true, tension: 160, friction: 12 }),
      Animated.timing(undoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
    if (listUndoTimer.current) clearTimeout(listUndoTimer.current);
    listUndoTimer.current = setTimeout(async () => {
      setListUndoVisible(false);
      setPendingListDelete(null);
      await supabase.from('lists').delete().eq('id', listId);
    }, 4000);
  }

  function undoListDelete() {
    if (!pendingListDelete) return;
    if (listUndoTimer.current) clearTimeout(listUndoTimer.current);
    setLists(pendingListDelete.items);
    setPendingListDelete(null);
    setListUndoVisible(false);
  }

  async function openPeek(list: (typeof lists)[0]) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const { data } = await supabase
      .from('list_items').select('id, text, checked').eq('list_id', list.id).order('created_at', { ascending: true }).limit(5);
    setPeekItems(data ?? []);
    setPeekTarget({ list, x: 0, y: 0 });
  }

  function openReorder() {
    setReorderList([...sortedLists]);
    setReorderModalVisible(true);
  }

  async function saveReorder() {
    const updated = reorderList.map((l, i) => ({ ...l, sort_order: i }));
    setLists(updated);
    setReorderModalVisible(false);
    for (const l of updated) {
      await supabase.from('lists').update({ sort_order: l.sort_order }).eq('id', l.id);
    }
  }

  async function createNewList() {
    if (!newListName.trim() || !user || user.id === 'dev') return;
    setNewListCreating(true);
    const { data } = await supabase.from('lists').insert({
      user_id: user.id,
      name: newListName.trim(),
      emoji: '📝',
      sort_order: lists.length,
    }).select('id, name, emoji, sort_order, list_type, user_id, created_at').single();
    if (data) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setLists(prev => [...prev, { ...data, item_count: 0, open_count: 0 }]);
    }
    setNewListCreating(false);
    setNewListModalVisible(false);
    setNewListName('');
  }

  useEffect(() => { if (settings.receipts_enabled) fetchReceipts(); }, [fetchReceipts, settings.receipts_enabled]);

  useEffect(() => {
    if (lists.length === 0 && !loading) {
      breathLoopRef.current = Animated.loop(
        Animated.sequence([
          Animated.timing(emptyBreath, { toValue: 1.08, duration: 900, useNativeDriver: true }),
          Animated.timing(emptyBreath, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      );
      breathLoopRef.current.start();
    } else {
      breathLoopRef.current?.stop();
      emptyBreath.setValue(1);
    }
    return () => { breathLoopRef.current?.stop(); };
  }, [lists.length, loading]);

  const bannerTranslateY = scrollY.interpolate({ inputRange: [0, 120], outputRange: [0, -36], extrapolate: 'clamp' });

  const showNotesTab    = settings.notes_enabled;
  const showReceiptsTab = settings.receipts_enabled;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      {/* Banner */}
      <Animated.View style={[styles.banner, { paddingTop: insets.top + 44, transform: [{ translateY: bannerTranslateY }] }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
        <Text style={styles.bannerEyebrow}>
          {settings.user_name ? `${getGreeting()}, ${settings.user_name} 👋` : `${getGreeting()} 👋`}
        </Text>
        <Text style={styles.bannerTitle}>
          {activeTab === 'lists' ? 'Mijn lijsten' : activeTab === 'notes' ? 'Notities' : 'Bonnetjes'}
        </Text>

        {activeTab === 'lists' && (
          <View style={styles.bannerStats}>
            <View style={styles.statTile}>
              <Text style={styles.statNum}>{lists.length}</Text>
              <Text style={styles.statLabel}>{lists.length === 1 ? 'lijst' : 'lijsten'}</Text>
            </View>
            <View style={[styles.statTile, styles.statTileAccent]}>
              <Text style={[styles.statNum, { color: Colors.black }]}>{lists.reduce((s, l) => s + l.item_count, 0)}</Text>
              <Text style={[styles.statLabel, { color: 'rgba(0,0,0,0.55)' }]}>items totaal</Text>
            </View>
          </View>
        )}

        {activeTab === 'notes' && (
          <View style={[styles.searchBar, searchFocused && styles.searchBarFocused]}>
            <Ionicons name="search-outline" size={15} color={searchFocused ? Colors.yellow : colors.gray400} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Zoeken in notities..."
              placeholderTextColor={colors.gray400}
              selectionColor={Colors.yellow}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle-outline" size={16} color={colors.gray400} />
              </TouchableOpacity>
            )}
          </View>
        )}
      </Animated.View>

      {/* Toggle */}
      {(showNotesTab || showReceiptsTab) && (
        <View style={[styles.tabToggleWrap, { backgroundColor: colors.offWhite }]}>
          <TouchableOpacity style={styles.tabTextBtn} onPress={() => switchTab('lists')}>
            <Text style={[styles.tabTextLabel, { color: activeTab === 'lists' ? colors.black : colors.gray400 }]}>Lijsten</Text>
            {activeTab === 'lists' && <View style={[styles.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
          </TouchableOpacity>
          {showNotesTab && (
            <TouchableOpacity style={styles.tabTextBtn} onPress={() => switchTab('notes')}>
              <Text style={[styles.tabTextLabel, { color: activeTab === 'notes' ? colors.black : colors.gray400 }]}>Notities</Text>
              {activeTab === 'notes' && <View style={[styles.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
            </TouchableOpacity>
          )}
          {showReceiptsTab && (
            <TouchableOpacity style={styles.tabTextBtn} onPress={() => { switchTab('receipts'); fetchReceipts(); }}>
              <Text style={[styles.tabTextLabel, { color: activeTab === 'receipts' ? colors.black : colors.gray400 }]}>Bonnetjes</Text>
              {activeTab === 'receipts' && <View style={[styles.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Lists view */}
      {activeTab === 'lists' && (
        loading ? (
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map(i => <SkeletonListCard key={i} />)}
          </View>
        ) : fetchError ? (
          <View style={[styles.emptyContainer, { backgroundColor: colors.offWhite }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="cloud-offline-outline" size={32} color={colors.gray400} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.black }]}>Kon lijsten niet laden</Text>
            <Text style={[styles.emptyText, { color: colors.gray400 }]}>Controleer je verbinding en probeer opnieuw.</Text>
            <TouchableOpacity
              onPress={() => { setLoading(true); setFetchError(false); fetchLists(); }}
              style={[styles.retryBtn, { backgroundColor: Colors.yellow }]}
              activeOpacity={0.8}
            >
              <Text style={styles.retryBtnText}>Probeer opnieuw</Text>
            </TouchableOpacity>
          </View>
        ) : lists.length === 0 ? (
          <ScrollView
            style={{ backgroundColor: colors.offWhite }}
            contentContainerStyle={styles.emptyScrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); }} tintColor={Colors.yellow} colors={[Colors.yellow]} />}
          >
            {showBanner && (
              <GettingStartedBanner
                userId={user?.id ?? null}
                onDismiss={() => updateSetting('getting_started_dismissed', true)}
                colors={colors}
              />
            )}
            <View style={styles.emptyContainer}>
              <LinearGradient colors={['#FCC10C22', '#FCC10C00']} style={styles.emptyGlow} />
              <Animated.View style={[styles.emptyIcon, { backgroundColor: colors.gray100, transform: [{ scale: emptyBreath }] }]}>
                <Ionicons name="layers-outline" size={32} color={colors.gray400} />
              </Animated.View>
              <Text style={[styles.emptyTitle, { color: colors.black }]}>Nog geen lijsten</Text>
              <Text style={[styles.emptyText, { color: colors.gray400 }]}>
                Stuur een WhatsApp-bericht zoals:{'\n'}
                <Text style={styles.exampleMsg}>"maak een lijst"</Text>
              </Text>
              <TouchableOpacity
                onPress={() => Linking.openURL(`whatsapp://send?phone=${BOT_NUMBER}&text=maak een lijst`)}
                style={styles.emptyActionBtn}
                activeOpacity={0.8}
              >
                <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.emptyActionBtnGrad}>
                  <Ionicons name="logo-whatsapp" size={16} color={Colors.black} />
                  <Text style={styles.emptyActionBtnText}>Open WhatsApp</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <ScrollView
            style={{ backgroundColor: colors.offWhite }}
            onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); }} tintColor={Colors.yellow} colors={[Colors.yellow]} />}
            contentContainerStyle={[styles.tileGrid, showBanner && { paddingTop: 0 }]}
          >
            {showBanner && (
              <GettingStartedBanner userId={user?.id ?? null} onDismiss={() => updateSetting('getting_started_dismissed', true)} colors={colors} />
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <SortToggle value={sortMode} onChange={setSortMode} colors={colors} />
              <TouchableOpacity onPress={openReorder} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="swap-vertical-outline" size={18} color={colors.gray400} />
              </TouchableOpacity>
            </View>
            {/* Active lists */}
            {activeLists.length > 0 && (
              <View style={styles.tileRow}>
                {activeLists.map((item, index) => (
                  <AnimatedCard key={item.id} item={item} index={index} colors={colors}
                    showHint={!swipeHintDone && index === 0}
                    onHintComplete={() => { setSwipeHintDone(true); AsyncStorage.setItem('swipe_hint_done', '1'); }}
                    onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
                    onDeleteConfirm={() => setDeleteSheet({ listId: item.id, listName: item.name })}
                    onLongPress={() => openPeek(item)}
                  />
                ))}
              </View>
            )}
            {/* Done lists sink to bottom */}
            {doneLists.length > 0 && (
              <>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 14, gap: 10 }}>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.gray100 }} />
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8 }}>Klaar ({doneLists.length})</Text>
                  <View style={{ flex: 1, height: 1, backgroundColor: colors.gray100 }} />
                </View>
                <View style={styles.tileRow}>
                  {doneLists.map((item, index) => (
                    <AnimatedCard key={item.id} item={item} index={activeLists.length + index} colors={colors}
                      onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
                      onDeleteConfirm={() => setDeleteSheet({ listId: item.id, listName: item.name })}
                      onLongPress={() => openPeek(item)}
                    />
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        )
      )}

      {/* Notes view */}
      {activeTab === 'notes' && (
        filteredNotes.length === 0 ? (
          <View style={[styles.emptyContainer, { backgroundColor: colors.offWhite }]}>
            <View style={[styles.emptyIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="document-text-outline" size={32} color={colors.gray400} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.black }]}>{search ? 'Geen resultaten' : 'Geen notities'}</Text>
            {!search && (
              <Text style={[styles.emptyText, { color: colors.gray400 }]}>
                Stuur via WhatsApp:{'\n'}
                <Text style={styles.exampleMsg}>"onthoud: altijd bellen voor je bij Jan langskomt"</Text>
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            data={filteredNotes}
            keyExtractor={(n) => n.id}
            numColumns={2}
            contentContainerStyle={styles.noteGrid}
            columnWrapperStyle={styles.noteRow}
            style={{ backgroundColor: colors.offWhite }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotes(); }} tintColor={Colors.yellow} colors={[Colors.yellow]} />}
            renderItem={({ item, index }) => (
              <NoteCard item={item} index={index} isDark={isDark} onPress={() => setSelectedNote(item)} />
            )}
          />
        )
      )}

      {/* Receipts view */}
      {activeTab === 'receipts' && (() => {
        const filteredReceipts = selectedCatId
          ? receipts.filter(r => r.receipt_category_id === selectedCatId)
          : receipts;
        const catTotal = filteredReceipts.reduce((s, r) => s + (r.total ?? 0), 0);
        const activeCat = receiptCats.find(c => c.id === selectedCatId);

        return (
          <View style={{ flex: 1, backgroundColor: colors.offWhite }}>
            {/* Category + PDF bar */}
            <View style={{ paddingVertical: 10, backgroundColor: colors.offWhite }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
                <TouchableOpacity
                  onPress={() => setSelectedCatId(null)}
                  style={[rStyles.chip, { backgroundColor: !selectedCatId ? colors.black : colors.white, borderColor: colors.gray200 }]}
                >
                  <Text style={[rStyles.chipText, { color: !selectedCatId ? colors.white : colors.gray400 }]}>Alle</Text>
                </TouchableOpacity>
                {receiptCats.map(cat => (
                  <TouchableOpacity
                    key={cat.id}
                    onPress={() => setSelectedCatId(selectedCatId === cat.id ? null : cat.id)}
                    onLongPress={() => Alert.alert(`${cat.emoji} ${cat.name}`, 'Categorie verwijderen?', [
                      { text: 'Annuleer', style: 'cancel' },
                      { text: 'Verwijder', style: 'destructive', onPress: async () => {
                        await fetch(`${API_BASE}/receipt-categories/${user?.id}/${cat.id}`, { method: 'DELETE' });
                        setReceiptCats(prev => prev.filter(c => c.id !== cat.id));
                        if (selectedCatId === cat.id) setSelectedCatId(null);
                      }},
                    ])}
                    style={[rStyles.chip, { backgroundColor: selectedCatId === cat.id ? cat.color : colors.white, borderColor: selectedCatId === cat.id ? cat.color : colors.gray200 }]}
                  >
                    <Text style={{ fontSize: 13 }}>{cat.emoji}</Text>
                    <Text style={[rStyles.chipText, { color: selectedCatId === cat.id ? '#fff' : colors.black }]}>{cat.name}</Text>
                  </TouchableOpacity>
                ))}
                <TouchableOpacity
                  onPress={() => { setNewCatName(''); setNewCatEmoji(''); setNewCatColor(CAT_COLORS[0]); setCatModalVisible(true); }}
                  style={[rStyles.chip, { backgroundColor: colors.white, borderColor: colors.gray200, borderStyle: 'dashed' }]}
                >
                  <Ionicons name="add" size={15} color={colors.gray400} />
                  <Text style={[rStyles.chipText, { color: colors.gray400 }]}>Nieuw</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const url = `${API_BASE}/receipts/${user?.id}/export.pdf${selectedCatId ? `?categoryId=${selectedCatId}` : ''}`;
                    Linking.openURL(url);
                  }}
                  style={[rStyles.chip, { backgroundColor: Colors.yellow, borderColor: Colors.yellow }]}
                >
                  <Ionicons name="download-outline" size={14} color={Colors.black} />
                  <Text style={[rStyles.chipText, { color: Colors.black }]}>PDF</Text>
                </TouchableOpacity>
              </ScrollView>
              {selectedCatId && (
                <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.gray400 }}>
                    {filteredReceipts.length} bonnetjes · totaal <Text style={{ fontFamily: 'Inter_700Bold', color: colors.black }}>{formatAmount(catTotal, filteredReceipts[0]?.currency)}</Text>
                  </Text>
                </View>
              )}
            </View>

            {filteredReceipts.length === 0 ? (
              <View style={[styles.emptyContainer, { backgroundColor: colors.offWhite }]}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="receipt-outline" size={32} color={colors.gray400} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.black }]}>
                  {selectedCatId ? `Geen bonnetjes in ${activeCat?.name}` : 'Geen bonnetjes'}
                </Text>
                <Text style={[styles.emptyText, { color: colors.gray400 }]}>
                  Stuur een foto van een kassabon via WhatsApp.
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredReceipts}
                keyExtractor={r => r.id}
                contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
                style={{ backgroundColor: colors.offWhite }}
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchReceipts().then(() => setRefreshing(false)); }} tintColor={Colors.yellow} colors={[Colors.yellow]} />}
                renderItem={({ item }) => {
                  const itemCat = receiptCats.find(c => c.id === item.receipt_category_id);
                  return (
                    <TouchableOpacity
                      style={[{ backgroundColor: colors.white, borderRadius: Radius.lg, overflow: 'hidden' }, Shadow.card]}
                      activeOpacity={0.85}
                      onPress={() => setDetailReceipt(item)}
                      onLongPress={() => Alert.alert(item.store ?? 'Bonnetje', 'Wat wil je doen?', [
                        { text: 'Categorie wijzigen', onPress: () => setAssignModalReceipt(item) },
                        { text: 'Verwijderen', style: 'destructive', onPress: async () => {
                          await fetch(`${API_BASE}/receipts/${user?.id}/${item.id}`, { method: 'DELETE' });
                          setReceipts(prev => prev.filter(r => r.id !== item.id));
                        }},
                        { text: 'Annuleer', style: 'cancel' },
                      ])}
                    >
                      {itemCat && <View style={{ height: 4, backgroundColor: itemCat.color }} />}
                      {item.image_url && <Image source={{ uri: item.image_url }} style={{ width: '100%', height: 130 }} resizeMode="cover" />}
                      <View style={{ padding: 14 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                          <Text style={{ fontSize: 22 }}>{RECEIPT_EMOJI[item.category ?? ''] ?? '🧾'}</Text>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.black }} numberOfLines={1}>
                              {item.store ?? 'Onbekende winkel'}
                            </Text>
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                              {item.date && <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.gray400 }}>{formatReceiptDate(item.date)}</Text>}
                              {itemCat && <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: itemCat.color }}>{itemCat.emoji} {itemCat.name}</Text>}
                            </View>
                          </View>
                          {item.total != null && (
                            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black }}>
                              {formatAmount(item.total, item.currency)}
                            </Text>
                          )}
                        </View>
                        {item.description && (
                          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.gray400, marginTop: 6 }} numberOfLines={2}>
                            {item.description}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        );
      })()}

      {/* Receipt detail modal */}
      <Modal visible={!!detailReceipt} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setDetailReceipt(null)}>
        {detailReceipt && (() => {
          const cat = receiptCats.find(c => c.id === detailReceipt.receipt_category_id);
          return (
            <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
              <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
                <TouchableOpacity onPress={() => setDetailReceipt(null)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="close" size={18} color={colors.black} />
                </TouchableOpacity>
                <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: colors.black }}>
                  {detailReceipt.store ?? 'Bonnetje'}
                </Text>
                <TouchableOpacity onPress={() => { setAssignModalReceipt(detailReceipt); setDetailReceipt(null); }} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="folder-outline" size={16} color={colors.black} />
                </TouchableOpacity>
              </View>
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                {detailReceipt.image_url && (
                  <Image source={{ uri: detailReceipt.image_url }} style={{ width: '100%', height: 260 }} resizeMode="cover" />
                )}
                <View style={{ padding: 20, gap: 16 }}>
                  <View style={{ gap: 4 }}>
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 22, color: colors.black }}>{detailReceipt.store ?? 'Onbekende winkel'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      {detailReceipt.date && <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.gray400 }}>{formatReceiptDate(detailReceipt.date)}</Text>}
                      {cat && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: cat.color + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 }}>
                        <Text style={{ fontSize: 11 }}>{cat.emoji}</Text>
                        <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: cat.color }}>{cat.name}</Text>
                      </View>}
                    </View>
                    {detailReceipt.total != null && (
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 32, color: colors.black, marginTop: 4 }}>
                        {formatAmount(detailReceipt.total, detailReceipt.currency)}
                      </Text>
                    )}
                  </View>
                  {detailReceipt.description && (
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray400, lineHeight: 20 }}>
                      {detailReceipt.description}
                    </Text>
                  )}
                  {Array.isArray(detailReceipt.items) && detailReceipt.items.length > 0 && (
                    <View style={{ gap: 0 }}>
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: colors.black, marginBottom: 10 }}>Artikelen</Text>
                      {detailReceipt.items.map((item: any, i: number) => (
                        <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
                          <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.black, flex: 1 }}>
                            {item.quantity && item.quantity > 1 ? `${item.quantity}× ` : ''}{item.name}
                          </Text>
                          {item.price != null && (
                            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.black }}>
                              {formatAmount(item.price, detailReceipt.currency)}
                            </Text>
                          )}
                        </View>
                      ))}
                    </View>
                  )}
                </View>
              </ScrollView>
            </SafeAreaView>
          );
        })()}
      </Modal>

      {/* Assign category modal */}
      <Modal visible={!!assignModalReceipt} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setAssignModalReceipt(null)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setAssignModalReceipt(null)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="close" size={18} color={colors.black} />
            </TouchableOpacity>
            <Text style={[styles.modalDate, { color: colors.black, fontFamily: 'Inter_700Bold', fontSize: 15 }]}>Categorie kiezen</Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
            <TouchableOpacity
              onPress={() => assignReceiptCat(assignModalReceipt!.id, null)}
              style={[rStyles.assignRow, { backgroundColor: colors.offWhite }, !assignModalReceipt?.receipt_category_id && { borderWidth: 2, borderColor: Colors.yellow }]}
            >
              <Text style={{ fontSize: 20 }}>🧾</Text>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.black, flex: 1 }}>Geen categorie</Text>
              {!assignModalReceipt?.receipt_category_id && <Ionicons name="checkmark-circle" size={20} color={Colors.yellow} />}
            </TouchableOpacity>
            {receiptCats.map(cat => (
              <TouchableOpacity
                key={cat.id}
                onPress={() => assignReceiptCat(assignModalReceipt!.id, cat.id)}
                style={[rStyles.assignRow, { backgroundColor: colors.offWhite }, assignModalReceipt?.receipt_category_id === cat.id && { borderWidth: 2, borderColor: cat.color }]}
              >
                <Text style={{ fontSize: 20 }}>{cat.emoji}</Text>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 15, color: colors.black, flex: 1 }}>{cat.name}</Text>
                {assignModalReceipt?.receipt_category_id === cat.id && <Ionicons name="checkmark-circle" size={20} color={cat.color} />}
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => { setAssignModalReceipt(null); setNewCatName(''); setNewCatEmoji(''); setNewCatColor(CAT_COLORS[0]); setCatModalVisible(true); }} style={[rStyles.assignRow, { backgroundColor: colors.offWhite, borderStyle: 'dashed', borderWidth: 1, borderColor: colors.gray200 }]}>
              <Ionicons name="add-circle-outline" size={20} color={colors.gray400} />
              <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.gray400 }}>Nieuwe categorie aanmaken</Text>
            </TouchableOpacity>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* New category modal */}
      <Modal visible={catModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCatModalVisible(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.gray100 }}>
            <TouchableOpacity onPress={() => setCatModalVisible(false)} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: colors.gray100 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: colors.gray400 }}>Annuleer</Text>
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.black }}>Nieuwe categorie</Text>
            <TouchableOpacity onPress={createReceiptCat} disabled={!newCatName.trim()} style={{ paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: Colors.yellow, opacity: newCatName.trim() ? 1 : 0.4 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.black }}>Opslaan</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Naam</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 14, color: colors.black, backgroundColor: colors.offWhite, fontFamily: 'Inter_400Regular', fontSize: 16 }}
                value={newCatName}
                onChangeText={setNewCatName}
                placeholder="Bijv. Zweden, Werk, Thuis..."
                placeholderTextColor={colors.gray400}
                autoFocus
                selectionColor={Colors.yellow}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Emoji</Text>
              <TextInput
                style={{ borderWidth: 1, borderColor: colors.gray200, borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 14, color: colors.black, backgroundColor: colors.offWhite, fontFamily: 'Inter_400Regular', fontSize: 28 }}
                value={newCatEmoji}
                onChangeText={setNewCatEmoji}
                placeholder="📁"
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
              />
            </View>
            <View style={{ gap: 8 }}>
              <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400 }}>Kleur</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {CAT_COLORS.map(c => (
                  <TouchableOpacity key={c} onPress={() => setNewCatColor(c)} style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c, borderWidth: newCatColor === c ? 3 : 0, borderColor: colors.black }} />
                ))}
              </View>
            </View>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Note detail modal */}
      <Modal visible={!!selectedNote} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setSelectedNote(null)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="close" size={18} color={colors.black} />
            </TouchableOpacity>
            <Text style={[styles.modalDate, { color: colors.gray400 }]}>
              {selectedNote ? new Date(selectedNote.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
            </Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView contentContainerStyle={styles.modalContent}>
            {selectedNote?.title && <Text style={[styles.modalTitle, { color: colors.black }]}>{selectedNote.title}</Text>}
            <Text style={[styles.modalBody, { color: colors.gray800 }]}>{selectedNote?.body}</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* Delete list bottom sheet */}
      <ConfirmSheet
        visible={!!deleteSheet}
        title={`"${deleteSheet?.listName}" verwijderen?`}
        subtitle="Deze lijst en alle items worden permanent verwijderd."
        destructiveLabel="Verwijder lijst"
        onConfirm={() => deleteSheet && deleteList(deleteSheet.listId, deleteSheet.listName)}
        onCancel={() => setDeleteSheet(null)}
      />

      {/* Undo snackbar */}
      {listUndoVisible && (
        <Animated.View style={[undoStyles.snackbar, { bottom: insets.bottom + 90, opacity: undoOpacity, transform: [{ translateY: undoSlide }] }]}>
          <Text style={undoStyles.snackbarText}>"{pendingListDelete?.listName}" verwijderd</Text>
          <TouchableOpacity onPress={undoListDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={undoStyles.undoBtn}>Ongedaan maken</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Peek modal */}
      <Modal visible={!!peekTarget} transparent animationType="fade" onRequestClose={() => setPeekTarget(null)}>
        <Pressable style={peekStyles.overlay} onPress={() => setPeekTarget(null)}>
          <Pressable style={[peekStyles.card, { backgroundColor: colors.white }]} onPress={() => {}}>
            <View style={peekStyles.header}>
              <Text style={peekStyles.emoji}>{peekTarget?.list.emoji || '📝'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[peekStyles.title, { color: colors.black }]} numberOfLines={1}>{peekTarget?.list.name}</Text>
                <Text style={{ fontFamily: 'Inter_300Light', fontSize: 12, color: colors.gray400 }}>
                  {peekTarget?.list.open_count} open · {peekTarget?.list.item_count} totaal
                </Text>
              </View>
              <TouchableOpacity onPress={() => {
                setPeekTarget(null);
                if (peekTarget) router.push({ pathname: '/list/[id]', params: { id: peekTarget.list.id, name: peekTarget.list.name, emoji: peekTarget.list.emoji, list_type: peekTarget.list.list_type ?? 'checklist' } });
              }} style={peekStyles.openBtn}>
                <Text style={peekStyles.openBtnText}>Open</Text>
              </TouchableOpacity>
            </View>
            {(peekTarget?.list.item_count ?? 0) > 0 && (
              <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.gray100, marginBottom: 12, overflow: 'hidden' }}>
                <View style={{
                  height: 4,
                  borderRadius: 2,
                  width: `${((peekTarget!.list.item_count - peekTarget!.list.open_count) / peekTarget!.list.item_count) * 100}%` as any,
                  backgroundColor: peekTarget!.list.open_count === 0 ? '#4CAF50' : Colors.yellow,
                }} />
              </View>
            )}
            {peekItems.length === 0 ? (
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, paddingVertical: 8 }}>Geen items</Text>
            ) : (
              peekItems.map(pi => (
                <View key={pi.id} style={peekStyles.peekRow}>
                  <Ionicons name={pi.checked ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={pi.checked ? '#4CAF50' : colors.gray400} />
                  <Text style={[peekStyles.peekText, { color: colors.black, opacity: pi.checked ? 0.4 : 1, textDecorationLine: pi.checked ? 'line-through' : 'none' }]}>{pi.text}</Text>
                </View>
              ))
            )}
            {(peekTarget?.list.item_count ?? 0) > 5 && (
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 12, color: colors.gray400, marginTop: 6 }}>
                + {(peekTarget?.list.item_count ?? 0) - 5} meer items
              </Text>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Reorder modal */}
      <Modal visible={reorderModalVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setReorderModalVisible(false)}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setReorderModalVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="close" size={18} color={colors.black} />
            </TouchableOpacity>
            <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 16, color: colors.black, flex: 1, textAlign: 'center' }}>Volgorde wijzigen</Text>
            <TouchableOpacity onPress={saveReorder} style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.yellow }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.black }}>Opslaan</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 8 }}>
            {reorderList.map((item, index) => (
              <View key={item.id} style={[reorderStyles.row, { backgroundColor: colors.offWhite }]}>
                <Text style={{ fontSize: 20 }}>{item.emoji || '📝'}</Text>
                <Text style={[reorderStyles.name, { color: colors.black }]} numberOfLines={1}>{item.name}</Text>
                <View style={reorderStyles.arrows}>
                  <TouchableOpacity
                    onPress={() => {
                      if (index === 0) return;
                      const next = [...reorderList];
                      [next[index - 1], next[index]] = [next[index], next[index - 1]];
                      setReorderList(next);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    disabled={index === 0}
                  >
                    <Ionicons name="chevron-up" size={20} color={index === 0 ? colors.gray200 : colors.gray400} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      if (index === reorderList.length - 1) return;
                      const next = [...reorderList];
                      [next[index], next[index + 1]] = [next[index + 1], next[index]];
                      setReorderList(next);
                    }}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    disabled={index === reorderList.length - 1}
                  >
                    <Ionicons name="chevron-down" size={20} color={index === reorderList.length - 1 ? colors.gray200 : colors.gray400} />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {/* Bottom fade */}
      {activeTab === 'lists' && (
        <LinearGradient
          colors={[`${colors.offWhite}00`, colors.offWhite]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 100, pointerEvents: 'none' }}
        />
      )}

      {/* New list FAB */}
      {activeTab === 'lists' && (
        <TouchableOpacity
          style={[fabStyles.fab, { bottom: insets.bottom + 90 }]}
          onPress={() => { setNewListName(''); setNewListModalVisible(true); }}
          activeOpacity={0.85}
        >
          <LinearGradient colors={['#FCC10C', '#E5A800']} style={fabStyles.fabGrad}>
            <Ionicons name="add" size={26} color={Colors.black} />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* New list modal */}
      <Modal visible={newListModalVisible} transparent animationType="slide" onRequestClose={() => setNewListModalVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={sheetStyles.overlay} onPress={() => setNewListModalVisible(false)}>
          <Pressable style={[sheetStyles.sheet, { backgroundColor: colors.white, paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 32 }]} onPress={() => {}}>
            <View style={sheetStyles.handle} />
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
              <Text style={[sheetStyles.title, { color: colors.black, marginBottom: 0, textAlign: 'left' }]}>Nieuwe lijst</Text>
              <TouchableOpacity onPress={() => setNewListModalVisible(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="close" size={16} color={colors.gray600} />
              </TouchableOpacity>
            </View>
            <View style={[fabStyles.inputWrap, { backgroundColor: colors.gray100 }]}>
              <TextInput
                style={[fabStyles.input, { color: colors.black }]}
                value={newListName}
                onChangeText={setNewListName}
                placeholder="Naam van de lijst..."
                placeholderTextColor={colors.gray400}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={createNewList}
                selectionColor={Colors.yellow}
              />
            </View>
            <TouchableOpacity
              style={[sheetStyles.destructiveBtn, { backgroundColor: newListName.trim() ? Colors.yellow : colors.gray200 }]}
              onPress={createNewList}
              disabled={!newListName.trim() || newListCreating}
              activeOpacity={0.85}
            >
              {newListCreating
                ? <ActivityIndicator size="small" color={Colors.black} />
                : <Text style={[sheetStyles.destructiveBtnText, { color: Colors.black }]}>Lijst aanmaken</Text>
              }
            </TouchableOpacity>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </View>
    </GestureHandlerRootView>
  );
}

const fabStyles = StyleSheet.create({
  fab: {
    position: 'absolute', right: 20, width: 56, height: 56,
    borderRadius: 28, overflow: 'hidden',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  fabGrad: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  inputWrap: { borderRadius: Radius.pill, paddingHorizontal: 18, paddingVertical: 4, marginBottom: 4 },
  input: { fontFamily: 'Inter_400Regular', fontSize: 16, paddingVertical: 12 },
});

const rStyles = StyleSheet.create({
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#E0E0E0' },
  chipText:  { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: { paddingHorizontal: 28, paddingBottom: 32, borderBottomLeftRadius: 32, borderBottomRightRadius: 32, overflow: 'hidden' },
  bannerEyebrow: { fontFamily: 'Inter_300Light', fontSize: 13, color: 'rgba(255,255,255,0.55)', marginBottom: 8 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 34, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 20 },
  bannerStats: { flexDirection: 'row', gap: 10, marginTop: 4 },
  statTile: {
    paddingHorizontal: 20, paddingVertical: 14,
    backgroundColor: '#FFFFFF0F', borderRadius: 16,
    borderWidth: 1, borderColor: '#FFFFFF16', minWidth: 96,
  },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum: { fontFamily: 'Inter_700Bold', fontSize: 24, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 2 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchBarFocused: { borderColor: Colors.yellow + '60' },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.white },

  tabToggleWrap: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, gap: 24 },
  tabTextBtn: { alignItems: 'center', paddingBottom: 8 },
  tabTextLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.3 },
  tabTextUnderline: { height: 3, width: '100%', borderRadius: 2, marginTop: 5 },

  skeletonList: { padding: 20 },
  tileGrid: { padding: 20, paddingTop: 0, paddingBottom: TAB_BAR_CLEARANCE },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 16 },
  tileWrap: { flex: 1, minWidth: '46%' },
  tile: { flex: 1, borderRadius: 20, overflow: 'hidden', padding: 22, minHeight: 172, justifyContent: 'space-between', ...Shadow.card },
  tileEmoji: { fontSize: 30, marginBottom: 16 },
  tileBottom: {},
  tileName: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.3, marginBottom: 7 },
  tileCountRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tileCount: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  typeBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.4 },
  tileProgressBg: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, backgroundColor: 'rgba(0,0,0,0.12)', borderBottomLeftRadius: 22, borderBottomRightRadius: 22, overflow: 'hidden' },
  tileProgressFill: { height: 5, borderBottomLeftRadius: 22 },
  retryBtn: { borderRadius: Radius.pill, paddingVertical: 13, paddingHorizontal: 28, marginTop: 8 },
  retryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.black },

  noteGrid: { padding: 20, paddingBottom: TAB_BAR_CLEARANCE },
  noteRow: { gap: 14, marginBottom: 14 },
  noteCard: { flex: 1, borderRadius: 20, padding: 18, minHeight: 140, ...Shadow.card },
  noteCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, marginBottom: 9, letterSpacing: -0.3 },
  noteCardBody: { fontFamily: 'Inter_300Light', fontSize: 13, lineHeight: 20, flex: 1 },
  noteCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  noteCardDate: { fontFamily: 'Inter_300Light', fontSize: 11 },

  emptyScrollContent: { flexGrow: 1, paddingBottom: 60 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyGlow: { position: 'absolute', top: -60, width: 300, height: 300, borderRadius: 150 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 8 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 15, textAlign: 'center', lineHeight: 24, marginBottom: 20 },
  exampleMsg: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.gray600, fontStyle: 'italic' },
  emptyActionBtn: { marginTop: 4 },
  emptyActionBtnGrad: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: Radius.pill, paddingVertical: 13, paddingHorizontal: 22,
  },
  emptyActionBtnText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.black },

  gettingStartedCard: {
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 8,
    borderRadius: Radius.lg,
    padding: 18,
    ...Shadow.card,
  },
  gettingStartedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  gettingStartedTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  quickActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.gray100,
  },
  quickActionIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickActionLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },
  allDoneRow: { marginTop: 8, alignItems: 'center', paddingVertical: 6 },
  allDoneText: { fontFamily: 'Inter_400Regular', fontSize: 13 },

  modal: { flex: 1 },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1,
  },
  closeBtn: { width: 34, height: 34, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  modalDate: { fontFamily: 'Inter_300Light', fontSize: 13 },
  modalContent: { padding: 28, paddingBottom: 60 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, marginBottom: 16, letterSpacing: -0.8 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 17, lineHeight: 30 },
});

const undoStyles = StyleSheet.create({
  snackbar: {
    position: 'absolute', left: 16, right: 16, backgroundColor: '#1A1A1A',
    borderRadius: Radius.pill, paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    zIndex: 9999, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  snackbarText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.white, flex: 1 },
  undoBtn: { fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.yellow, marginLeft: 12 },
});

const peekStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: { width: '100%', borderRadius: Radius.xl, padding: 20, gap: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  emoji: { fontSize: 28 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  openBtn: { backgroundColor: Colors.yellow, paddingHorizontal: 14, paddingVertical: 8, borderRadius: Radius.pill },
  openBtnText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: Colors.black },
  peekRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 5 },
  peekText: { fontFamily: 'Inter_400Regular', fontSize: 14, flex: 1 },
});

const reorderStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg },
  name: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  arrows: { flexDirection: 'row', gap: 8, flexShrink: 0 },
});
