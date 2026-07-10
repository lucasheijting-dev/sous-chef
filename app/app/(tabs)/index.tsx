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
  PanResponder,
  Pressable,
  Platform,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  ScrollView,
  Linking,
  Image,
  Alert,
  ActivityIndicator,
  Share,
  AppState,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { useModuleSettings } from '@/context/ModuleSettingsContext';
import { List, Note, NoteCategory } from '@/lib/types';
import { Colors, Shadow, Radius, TAB_BAR_CLEARANCE, getTone, TONE_ORDER, Tones } from '@/constants/Design';
import { SkeletonListCard } from '@/components/SkeletonCard';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getCache, setCache } from '@/lib/cache';
import { setListRefreshHandler } from '@/lib/listEvents';
import { SwipeDeleteRow } from '@/components/SwipeDeleteRow';
import { Toast, useToast } from '@/components/Toast';

const BOT_NUMBER = '31684965318';
import { apiFetch, API_BASE } from '@/lib/api';

function getGreeting(): string {
  const h = new Date().getHours();
  const day = new Date().getDay(); // 0=Sun, 6=Sat
  const weekend = day === 0 || day === 6;
  if (h >= 5  && h < 12) return weekend ? 'Goed weekend' : 'Goedemorgen';
  if (h >= 12 && h < 18) return 'Goedemiddag';
  return 'Goedenavond';
}

// Tone order for list tiles — cycles through 6 warm tones
const TILE_TONE_ORDER = TONE_ORDER;

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

function memberInitial(m: { display_name?: string; whatsapp_number?: string }): string | null {
  if (m.display_name?.trim()) return m.display_name.trim()[0].toUpperCase();
  return null; // no display_name → show person icon instead
}

function AnimatedCard({
  item,
  index,
  onPress,
  onDelete,
  onEmojiPress,
  highlighted,
}: {
  item: List & { item_count: number; open_count: number; is_shared?: boolean; is_default?: boolean; shared_with_me?: boolean; members?: Array<{ display_name?: string; whatsapp_number?: string }> };
  index: number;
  onPress: () => void;
  onDelete: () => void;
  onEmojiPress: () => void;
  highlighted?: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const doneFlash = useRef(new Animated.Value(0)).current;

  const { colors, isDark } = useTheme();
  const tone = getTone(index, isDark);
  const allDone = !item.is_shared && !item.shared_with_me && item.item_count > 0 && item.open_count === 0;
  const prevAllDone = useRef(allDone);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, delay: index * 40, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 200, delay: index * 40, useNativeDriver: true }),
    ]).start();
  }, []);

  useEffect(() => {
    if (allDone && !prevAllDone.current) {
      Animated.sequence([
        Animated.spring(scale, { toValue: 1.06, useNativeDriver: true, speed: 60 }),
        Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 60 }),
        Animated.timing(doneFlash, { toValue: 1, duration: 120, useNativeDriver: true }),
        Animated.timing(doneFlash, { toValue: 0, duration: 400, useNativeDriver: true }),
      ]).start();
    }
    prevAllDone.current = allDone;
  }, [allDone]);

  const typeLabel = item.list_type === 'links' ? 'Links' : item.list_type === 'tips' ? 'Tips' : null;
  const totalCount = item.item_count;
  const openCount = item.open_count;
  const progress = totalCount > 0 ? (totalCount - openCount) / totalCount : 0;

  const cardContent = (
    <Pressable
      onPress={onPress}
      onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
      onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
      style={[styles.tile, { backgroundColor: colors.surface }, highlighted && { borderWidth: 2, borderColor: Colors.yellow }]}
    >
      {/* Tappable emoji icon */}
      <TouchableOpacity
        onPress={onEmojiPress}
        activeOpacity={0.75}
        hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
        style={[styles.tileIconBox, { backgroundColor: tone.bg }]}
      >
        <Text style={styles.tileEmoji}>{item.emoji || '📝'}</Text>
      </TouchableOpacity>
      <View style={styles.tileBottom}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[styles.tileName, { color: colors.black, flex: 1 }]} numberOfLines={1}>{item.name}</Text>
        </View>
        <View style={styles.tileCountRow}>
          {totalCount > 0 ? (
            allDone ? (
              <Text style={[styles.tileCount, { color: '#5A8A5A', fontFamily: 'Inter_600SemiBold' }]}>✓ Klaar</Text>
            ) : (
              <Text style={[styles.tileCount, { color: colors.gray400 }]}>{totalCount - openCount}/{totalCount}</Text>
            )
          ) : (
            <Text style={[styles.tileCount, { color: colors.gray400 }]}>Leeg</Text>
          )}
          {typeLabel && (
            <View style={[styles.typeBadge, { backgroundColor: colors.gray100 }]}>
              <Text style={[styles.typeBadgeText, { color: colors.gray400 }]}>{typeLabel}</Text>
            </View>
          )}
          {item.is_shared && (item.members ?? []).length > 0 && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: -4 }}>
              {(item.members ?? []).slice(0, 3).map((m, i) => {
                const initial = memberInitial(m);
                return (
                  <View key={i} style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: colors.gray200, borderWidth: 1.5, borderColor: colors.surface, alignItems: 'center', justifyContent: 'center', zIndex: 3 - i }}>
                    {initial
                      ? <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 8, color: colors.gray600 }}>{initial}</Text>
                      : <Ionicons name="person" size={9} color={colors.gray600} />
                    }
                  </View>
                );
              })}
            </View>
          )}
          {item.is_shared && (item.members ?? []).length === 0 && (
            <Ionicons name="people-outline" size={12} color={colors.gray400} />
          )}
        </View>
      </View>

      {totalCount > 0 && (
        <View style={styles.tileProgressBg}>
          <View style={[StyleSheet.absoluteFillObject, { opacity: 0.15, backgroundColor: tone.fg }]} />
          <View style={[styles.tileProgressFill, { width: `${progress * 100}%` as any, backgroundColor: allDone ? '#5A8A5A' : tone.fg }]} />
        </View>
      )}

      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: Radius.lg, backgroundColor: '#5A8A5A', opacity: doneFlash }]}
      />
    </Pressable>
  );

  return (
    <Animated.View style={[styles.tileWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale }] }]}>
      {item.is_default ? (
        cardContent
      ) : (
        <SwipeDeleteRow onDelete={onDelete} borderRadius={Radius.lg} deleteWidth={80}>
          {cardContent}
        </SwipeDeleteRow>
      )}
    </Animated.View>
  );
}


// ── Notes ──────────────────────────────────────────────────────────────────────

function getCardStyles(isDark: boolean) {
  return [
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: Colors.black, title: Colors.yellow, body: '#888', date: '#444' },
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: isDark ? '#242426' : '#F5F5F0', title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
  ];
}

function HighlightText({ text, query, style, numberOfLines }: { text: string; query: string; style: any; numberOfLines?: number }) {
  if (!query.trim()) return <Text style={style} numberOfLines={numberOfLines}>{text}</Text>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <Text key={i} style={[style, { backgroundColor: Colors.yellow + 'AA', color: Colors.black, borderRadius: 2 }]}>{part}</Text>
          : part
      )}
    </Text>
  );
}

function NoteCard({ item, index, onPress, search, category }: { item: Note; index: number; onPress: () => void; isDark?: boolean; search?: string; category?: NoteCategory }) {
  const { colors, isDark } = useTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(24)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const tone = getTone(index, isDark);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 280, delay: (index % 4) * 45, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, delay: (index % 4) * 45, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();
  }, []);

  const dateLabel = (() => {
    const diff = Math.floor((Date.now() - new Date(item.created_at).getTime()) / 86400000);
    if (diff === 0) return 'Vandaag';
    if (diff === 1) return 'Gisteren';
    if (diff < 7) return `${diff}d geleden`;
    return new Date(item.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  })();

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.975, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        style={[styles.noteCard, { backgroundColor: colors.surface }]}
      >
        <HighlightText
          text={item.title || item.body.slice(0, 60)}
          query={search ?? ''}
          style={[styles.noteCardTitle, { color: colors.black }]}
          numberOfLines={2}
        />
        <HighlightText
          text={item.body}
          query={search ?? ''}
          style={[styles.noteCardBody, { color: colors.gray400 }]}
          numberOfLines={4}
        />
        <View style={styles.noteCardFooter}>
          {category ? (
            <View style={[styles.noteCardTag, { backgroundColor: category.color + '22' }]}>
              <Text style={{ fontSize: 11 }}>{category.emoji}</Text>
              <Text style={[styles.noteCardTagText, { color: category.color }]}>{category.name}</Text>
            </View>
          ) : (
            <View style={[styles.noteCardTag, { backgroundColor: tone.bg }]}>
              <Text style={[styles.noteCardTagText, { color: tone.fg }]}>Notitie</Text>
            </View>
          )}
          <Text style={[styles.noteCardDate, { color: colors.gray400 }]}>{dateLabel}</Text>
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

function SortToggle({ value, onChange }: { value: SortMode; onChange: (v: SortMode) => void }) {
  const { colors } = useTheme();
  const options: { key: SortMode; label: string }[] = [
    { key: 'recent', label: 'Eigen' },
    { key: 'az', label: 'A–Z' },
    { key: 'complete', label: 'Compleet' },
  ];
  return (
    <View style={sortStyles.row}>
      {options.map(opt => (
        <TouchableOpacity
          key={opt.key}
          onPress={() => onChange(opt.key)}
          style={[sortStyles.chip, value === opt.key
            ? { backgroundColor: colors.black }
            : { backgroundColor: colors.gray100, borderColor: 'transparent' }
          ]}
          activeOpacity={0.75}
        >
          <Text style={[sortStyles.chipText, { color: value === opt.key ? colors.offWhite : colors.gray400 }]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const sortStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 7 },
  chip: { height: 34, paddingHorizontal: 15, borderRadius: Radius.pill, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  chipText: { fontFamily: 'Inter_600SemiBold', fontSize: 13.5 },
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

  const listsScrollRef = useRef<any>(null);
  const notesScrollRef = useRef<any>(null);
  const receiptsScrollRef = useRef<any>(null);
  const { toastProps, show: showToast } = useToast();

  function switchTab(tab: Tab) {
    if (tab === activeTab) return;
    if (activeTab === 'lists') setListSearch('');
    if (activeTab === 'notes') setSearch('');
    setActiveTab(tab);
    AsyncStorage.setItem('home_active_tab', tab);
    setTimeout(() => {
      if (tab === 'lists') listsScrollRef.current?.scrollTo({ y: 0, animated: false });
      if (tab === 'notes') notesScrollRef.current?.scrollTo?.({ y: 0, animated: false });
      if (tab === 'receipts') receiptsScrollRef.current?.scrollToOffset?.({ offset: 0, animated: false });
    }, 50);
  }
  const [lists, setLists] = useState<(List & { item_count: number; open_count: number; is_shared?: boolean })[]>([]);
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
  const [pendingListDelete, setPendingListDelete] = useState<{ listId: string; listName: string; items: typeof lists } | null>(null);
  const [listUndoVisible, setListUndoVisible] = useState(false);
  const listUndoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDeleteIdRef = useRef<string | null>(null);
  const [reorderModalVisible, setReorderModalVisible] = useState(false);
  const [reorderList, setReorderList] = useState<typeof lists>([]);
  const [reorderDragIndex, setReorderDragIndex] = useState<number | null>(null);
  const [reorderTargetIndex, setReorderTargetIndex] = useState<number | null>(null);
  const [isDraggingReorder, setIsDraggingReorder] = useState(false);
  const reorderDragIndexRef = useRef<number | null>(null);
  const reorderTargetIndexRef = useRef<number | null>(null);
  const REORDER_ROW_H = 56;
  const [emojiPickerList, setEmojiPickerList] = useState<(typeof lists)[0] | null>(null);
  const [newListModalVisible, setNewListModalVisible] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListCreating, setNewListCreating] = useState(false);
  const [listSearch, setListSearch] = useState('');
  const [editingNote, setEditingNote] = useState(false);
  const [editNoteBody, setEditNoteBody] = useState('');
  const [editNoteTitle, setEditNoteTitle] = useState('');
  const [editNoteCatId, setEditNoteCatId] = useState<string | null>(null);
  const [noteEditKeyboardHeight, setNoteEditKeyboardHeight] = useState(0);
  const [addNoteVisible, setAddNoteVisible] = useState(false);
  const [addNoteTitle, setAddNoteTitle] = useState('');
  const [addNoteBody, setAddNoteBody] = useState('');
  const [addNoteSaving, setAddNoteSaving] = useState(false);
  const [noteCats, setNoteCats] = useState<NoteCategory[]>([]);
  const [selectedNoteCatId, setSelectedNoteCatId] = useState<string | null>(null);
  const [addNoteCatId, setAddNoteCatId] = useState<string | null>(null);
  const [newNoteCatVisible, setNewNoteCatVisible] = useState(false);
  const [newNoteCatName, setNewNoteCatName] = useState('');
  const [newNoteCatEmoji, setNewNoteCatEmoji] = useState('📁');
  const [newNoteCatSaving, setNewNoteCatSaving] = useState(false);

  const [highlightedListId, setHighlightedListId] = useState<string | null>(null);
  const prevListIdsRef = useRef<Set<string>>(new Set());
  const defaultsEnsured = useRef(false);

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
      // Ensure default lists exist before fetching (only once per session)
      if (!defaultsEnsured.current) {
        const ok = await apiFetch(`/lists/restore-defaults?user_id=${user.id}`, { method: 'POST' })
          .then(r => r.ok)
          .catch(() => false);
        if (ok) defaultsEnsured.current = true;
      }

      const [listsRes, sharedData] = await Promise.all([
        supabase
          .from('lists')
          .select('id, name, emoji, sort_order, list_type, is_default, default_type, list_items(checked)')
          .eq('user_id', user.id)
          .is('deleted_at', null)
          .order('sort_order', { ascending: true }),
        apiFetch(`/lists/shared?user_id=${user.id}`).then(r => r.json()).catch(() => ({ sharedWithMe: [], mySharedListIds: [], mySharedListMembers: {} })),
      ]);
      if (listsRes.data) {
        const sharedWithMe: any[] = sharedData?.sharedWithMe ?? [];
        const mySharedIds = new Set<string>(sharedData?.mySharedListIds ?? []);
        const mySharedListMembers: Record<string, Array<{ display_name?: string; whatsapp_number?: string }>> = sharedData?.mySharedListMembers ?? {};
        const ownedProcessed = listsRes.data.map((l: any) => {
          const items: any[] = Array.isArray(l.list_items) ? l.list_items : [];
          return { ...l, item_count: items.length, open_count: items.filter((li: any) => !li.checked).length, is_shared: mySharedIds.has(l.id), shared_with_me: false, members: mySharedListMembers[l.id] ?? [] };
        });
        const ownedIds = new Set(ownedProcessed.map((l: any) => l.id));
        const mergedAll = [
          ...ownedProcessed,
          ...sharedWithMe.filter((l: any) => !ownedIds.has(l.id)),
        ].filter((l: any) => l.id !== pendingDeleteIdRef.current);
        const newSharedList = mergedAll.find(l => l.is_shared && !prevListIdsRef.current.has(l.id));
        if (newSharedList && prevListIdsRef.current.size > 0) {
          setHighlightedListId(newSharedList.id);
          setTimeout(() => setHighlightedListId(null), 3000);
        }
        prevListIdsRef.current = new Set(mergedAll.map(l => l.id));
        setLists(mergedAll);
        setCache('cache_lists', mergedAll);
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
    const [notesRes] = await Promise.all([
      supabase.from('notes').select('id, user_id, title, body, created_at, updated_at, image_url, category_id').eq('user_id', user.id).order('created_at', { ascending: false }),
      apiFetch(`/notes/categories?user_id=${user.id}`).then(r => r.json()).then(cats => { if (Array.isArray(cats)) setNoteCats(cats); }).catch(() => {}),
    ]);
    if (notesRes.data) { setNotes(notesRes.data); setCache('cache_notes', notesRes.data); }
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_members' }, () => {
        if (fetchListsDebounceRef.current) clearTimeout(fetchListsDebounceRef.current);
        fetchListsDebounceRef.current = setTimeout(fetchLists, 400);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, fetchNotes)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, fetchLists, fetchNotes]);

  useFocusEffect(useCallback(() => {
    setListRefreshHandler(fetchLists);
    fetchLists();
    return () => { setListRefreshHandler(null); };
  }, [fetchLists]));

  useEffect(() => {
    getCache<(List & { item_count: number; open_count: number })[]>('cache_lists').then(d => {
      if (d) { setLists(d); setLoading(false); }
    });
    getCache<Note[]>('cache_notes').then(d => {
      if (d) setNotes(d);
    });
  }, []);

  const filteredNotes = notes.filter(n => {
    const matchesSearch = n.title?.toLowerCase().includes(search.toLowerCase()) || n.body.toLowerCase().includes(search.toLowerCase());
    const matchesCat = selectedNoteCatId ? n.category_id === selectedNoteCatId : true;
    return matchesSearch && matchesCat;
  });

  async function deleteNote(noteId: string) {
    setSelectedNote(null);
    setEditingNote(false);
    setNotes(prev => prev.filter(n => n.id !== noteId));
    apiFetch(`/notes/${noteId}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {});
  }

  async function saveNoteEdit() {
    if (!selectedNote) return;
    const body = editNoteBody.trim();
    if (!body) return;
    const title = editNoteTitle.trim() || null;
    const updated = { ...selectedNote, body, title, category_id: editNoteCatId };
    setNotes(prev => prev.map(n => n.id === selectedNote.id ? updated : n));
    setSelectedNote(updated);
    setEditingNote(false);
    await supabase.from('notes').update({ body, title, category_id: editNoteCatId }).eq('id', selectedNote.id);
  }

  const sortedLists = [...lists].sort((a, b) => {
    // Default lists always float to the top
    const aDefault = (a as any).is_default ? 0 : 1;
    const bDefault = (b as any).is_default ? 0 : 1;
    if (aDefault !== bDefault) return aDefault - bDefault;

    if (sortMode === 'az') return a.name.localeCompare(b.name, 'nl');
    if (sortMode === 'complete') {
      const pa = a.item_count > 0 ? (a.item_count - a.open_count) / a.item_count : 0;
      const pb = b.item_count > 0 ? (b.item_count - b.open_count) / b.item_count : 0;
      return pb - pa;
    }
    // Sink fully-done lists to the bottom (but not for default lists — they stay on top)
    if (!(a as any).is_default) {
      const aDone = a.item_count > 0 && a.open_count === 0 ? 1 : 0;
      const bDone = b.item_count > 0 && b.open_count === 0 ? 1 : 0;
      if (aDone !== bDone) return aDone - bDone;
    }
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const listSearchTerm = listSearch.trim().toLowerCase();
  const filteredSortedLists = listSearchTerm
    ? sortedLists.filter(l => l.name.toLowerCase().includes(listSearchTerm))
    : sortedLists;
  const pinnedLists   = filteredSortedLists.filter(l => !!(l as any).is_default);
  const sharedLists   = filteredSortedLists.filter(l => !(l as any).is_default && ((l as any).is_shared || (l as any).shared_with_me));
  const createdLists  = filteredSortedLists.filter(l => !(l as any).is_default && !(l as any).is_shared && !(l as any).shared_with_me);
  const isDone = (l: any) => !l.is_default && !l.is_shared && !l.shared_with_me && l.item_count > 0 && l.open_count === 0;
  const activeLists   = createdLists.filter(l => !isDone(l));
  const doneLists     = createdLists.filter(l => isDone(l));

  const [receiptError, setReceiptError] = useState(false);
  const [pendingReceiptDelete, setPendingReceiptDelete] = useState<Receipt | null>(null);
  const pendingReceiptDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchReceipts = useCallback(async () => {
    if (!user || user.id === 'dev') return;
    setReceiptError(false);
    try {
      const [rRes, cRes] = await Promise.all([
        apiFetch(`/receipts/${user.id}`),
        apiFetch(`/receipt-categories/${user.id}`),
      ]);
      const [rData, cData] = await Promise.all([rRes.json(), cRes.json()]);
      if (Array.isArray(rData)) setReceipts(rData);
      if (Array.isArray(cData)) setReceiptCats(cData);
    } catch {
      setReceiptError(true);
    }
  }, [user]);

  async function createReceiptCat() {
    if (!newCatName.trim() || !user) return;
    const emoji = [...newCatEmoji][0] ?? '📁';
    try {
      const res = await apiFetch(`/receipt-categories/${user.id}`, {
        method: 'POST',
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
    await apiFetch(`/receipt-categories/${user.id}/assign`, {
      method: 'PATCH',
      body: JSON.stringify({ receipt_id: receiptId, category_id: categoryId }),
    });
    setReceipts(prev => prev.map(r => r.id === receiptId ? { ...r, receipt_category_id: categoryId } : r));
    setAssignModalReceipt(null);
  }

  function deleteList(listId: string, listName: string, isDefault = false, isSharedWithMe = false) {
    if (isSharedWithMe) {
      Alert.alert(
        'Lijst verlaten?',
        `Je verlaat "${listName}". Je ziet deze lijst niet meer.`,
        [
          { text: 'Annuleer', style: 'cancel' },
          { text: 'Verlaten', style: 'destructive', onPress: () => {
            setLists(prev => prev.filter(l => l.id !== listId));
            apiFetch(`/lists/${listId}/leave?user_id=${user!.id}`, { method: 'DELETE' }).catch(() => {});
          }},
        ]
      );
      return;
    }

    const doDelete = () => {
      const snapshot = lists;
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      const filtered = lists.filter(l => l.id !== listId);
      setLists(filtered);
      setCache('cache_lists', filtered);
      setPendingListDelete({ listId, listName, items: snapshot });
      pendingDeleteIdRef.current = listId;
      setListUndoVisible(true);
      undoSlide.setValue(60);
      undoOpacity.setValue(0);
      Animated.parallel([
        Animated.spring(undoSlide, { toValue: 0, useNativeDriver: true, tension: 160, friction: 12 }),
        Animated.timing(undoOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      if (listUndoTimer.current) clearTimeout(listUndoTimer.current);
      listUndoTimer.current = setTimeout(async () => {
        Animated.parallel([
          Animated.timing(undoOpacity, { toValue: 0, duration: 200, useNativeDriver: true }),
          Animated.timing(undoSlide, { toValue: 60, duration: 220, useNativeDriver: true }),
        ]).start(() => {
          setListUndoVisible(false);
          setPendingListDelete(null);
        });
        await apiFetch(`/lists/${listId}?user_id=${user!.id}`, { method: 'DELETE' }).catch(() => {});
        pendingDeleteIdRef.current = null;
      }, 4000);
    };

    if (isDefault) {
      Alert.alert(
        `${listName} verwijderen?`,
        `Weet je zeker dat je ${listName} wilt verwijderen? Deze lijst en alle items worden permanent verwijderd en kunnen niet worden hersteld.\n\nJe kunt hem later herstellen via Instellingen → Lijsten.`,
        [
          { text: 'Annuleer', style: 'cancel' },
          { text: 'Verwijder', style: 'destructive', onPress: doDelete },
        ]
      );
    } else {
      doDelete();
    }
  }

  function undoListDelete() {
    if (!pendingListDelete) return;
    if (listUndoTimer.current) clearTimeout(listUndoTimer.current);
    setLists(pendingListDelete.items);
    setCache('cache_lists', pendingListDelete.items);
    setPendingListDelete(null);
    pendingDeleteIdRef.current = null;
    Animated.parallel([
      Animated.timing(undoOpacity, { toValue: 0, duration: 160, useNativeDriver: true }),
      Animated.timing(undoSlide, { toValue: 60, duration: 180, useNativeDriver: true }),
    ]).start(() => setListUndoVisible(false));
  }

  function openReorder() {
    setReorderList([...sortedLists]);
    setReorderModalVisible(true);
  }

  async function saveReorder() {
    const updated = reorderList.map((l, i) => ({ ...l, sort_order: i }));
    setLists(updated);
    setSortMode('recent');
    setReorderModalVisible(false);
    for (const l of updated) {
      await supabase.from('lists').update({ sort_order: l.sort_order }).eq('id', l.id);
    }
  }

  async function saveEmoji(listId: string, emoji: string) {
    setLists(prev => prev.map(l => l.id === listId ? { ...l, emoji } : l));
    setEmojiPickerList(null);
    await apiFetch(`/lists/${listId}/emoji?user_id=${user?.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ emoji }),
    });
  }

  async function duplicateList(item: (typeof lists)[0]) {
    if (!user || user.id === 'dev') return;
    const { data: newList } = await supabase.from('lists').insert({
      user_id: user.id, name: `${item.name} (kopie)`, emoji: item.emoji,
      sort_order: lists.length, list_type: item.list_type ?? 'checklist',
    }).select('id').single();
    if (!newList) return;
    const { data: srcItems } = await supabase.from('list_items').select('text, checked').eq('list_id', item.id);
    if (srcItems?.length) {
      await supabase.from('list_items').insert(srcItems.map(i => ({ list_id: newList.id, user_id: user.id, text: i.text, checked: false })));
    }
    fetchLists();
  }

  async function createNewList() {
    if (!newListName.trim() || !user || user.id === 'dev') return;
    setNewListCreating(true);
    const name = newListName.trim();
    const res = await apiFetch(`/lists?user_id=${user.id}`, {
      method: 'POST',
      body: JSON.stringify({ name, emoji: '📝' }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (data?.id) {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setLists(prev => [...prev, {
        id: data.id,
        name,
        emoji: '📝',
        sort_order: lists.length,
        list_type: data.list_type ?? 'checklist',
        user_id: user.id,
        created_at: new Date().toISOString(),
        item_count: 0,
        open_count: 0,
      }]);
    }
    setNewListCreating(false);
    setNewListModalVisible(false);
    setNewListName('');
  }

  useEffect(() => { if (settings.receipts_enabled) fetchReceipts(); }, [fetchReceipts, settings.receipts_enabled]);

  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', e => setNoteEditKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setNoteEditKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'background' && editingNote) {
        saveNoteEdit();
      }
    });
    return () => sub.remove();
  }, [editingNote, selectedNote, editNoteBody, editNoteTitle]);

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

  const showNotesTab    = settings.notes_enabled;
  const showReceiptsTab = settings.receipts_enabled;

  const pageTitle = activeTab === 'lists' ? 'Mijn lijsten' : activeTab === 'notes' ? 'Notities' : 'Bonnetjes';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>

      {/* ── Clean warm header ── */}
      <View style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            {settings.user_name ? (
              <Text style={[styles.headerGreet, { color: colors.gray400 }]}>
                {getGreeting()}, {settings.user_name}
              </Text>
            ) : (
              <Text style={[styles.headerGreet, { color: colors.gray400 }]}>{getGreeting()}</Text>
            )}
            <Text style={[styles.headerTitle, { color: colors.black }]} numberOfLines={1}>
              {pageTitle}
            </Text>
          </View>

        </View>
      </View>

      {/* ── Top tabs (Lijsten / Notities / Bonnetjes) ── */}
      {(showNotesTab || showReceiptsTab) && (
        <View style={[styles.tabToggleWrap, { backgroundColor: colors.offWhite, zIndex: 2 }]}>
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
        ) : (fetchError && lists.length === 0) ? (
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
              <LinearGradient colors={[Colors.yellow + '22', Colors.yellow + '00']} style={styles.emptyGlow} />
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
                <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={styles.emptyActionBtnGrad}>
                  <Ionicons name="logo-whatsapp" size={16} color={Colors.black} />
                  <Text style={styles.emptyActionBtnText}>Open WhatsApp</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </ScrollView>
        ) : (
          <>
            {/* Search sticky above scroll */}
            <View style={[styles.sortSticky, { backgroundColor: colors.offWhite, zIndex: 2, justifyContent: 'flex-end' }]}>
              <TouchableOpacity onPress={() => setListSearch(s => s ? '' : ' ')} hitSlop={{ top: 12, bottom: 12, left: 8, right: 12 }}>
                <Ionicons name={listSearch.trim() ? 'close-circle' : 'search-outline'} size={18} color={listSearch.trim() ? Colors.yellow : colors.gray400} />
              </TouchableOpacity>
            </View>
            {listSearch.trim().length > 0 && (
              <View style={[styles.searchBar, { marginHorizontal: 16, marginBottom: 4, backgroundColor: colors.gray100, borderColor: colors.gray200 }]}>
                <Ionicons name="search-outline" size={15} color={Colors.yellow} />
                <TextInput
                  style={[styles.searchInput, { color: colors.black }]}
                  value={listSearch}
                  onChangeText={setListSearch}
                  placeholder="Zoek in lijsten..."
                  placeholderTextColor={colors.gray400}
                  selectionColor={Colors.yellow}
                  autoFocus
                />
                <TouchableOpacity onPress={() => setListSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close-circle-outline" size={16} color={colors.gray400} />
                </TouchableOpacity>
              </View>
            )}
            {listSearch.trim().length > 0 && filteredSortedLists.length === 0 ? (
              <View style={[styles.emptyContainer, { backgroundColor: colors.offWhite }]}>
                <View style={[styles.emptyIcon, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="search-outline" size={32} color={colors.gray400} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.black }]}>Geen lijsten gevonden</Text>
                <Text style={[styles.emptyText, { color: colors.gray400 }]}>Geen lijsten voor "{listSearch.trim()}".</Text>
              </View>
            ) : (
          <ScrollView
            ref={listsScrollRef}
            style={{ backgroundColor: colors.offWhite }}
            scrollEventThrottle={16}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); }} tintColor={Colors.yellow} colors={[Colors.yellow]} />}
            contentContainerStyle={[styles.tileGrid, showBanner && { paddingTop: 0 }, { paddingBottom: insets.bottom + 160 }]}
          >
            {showBanner && (
              <GettingStartedBanner userId={user?.id ?? null} onDismiss={() => updateSetting('getting_started_dismissed', true)} colors={colors} />
            )}
            {/* ── Standaard ── */}
            {pinnedLists.length > 0 && (
              <>
                <View style={{ paddingHorizontal: 2, paddingBottom: 10, paddingTop: 2 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8 }}>Standaard</Text>
                </View>
                <View style={styles.tileRow}>
                  {pinnedLists.map((item, index) => (
                    <AnimatedCard key={item.id} item={item} index={index}
                      onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
                      onDelete={() => deleteList(item.id, item.name, true, false)}
                      onEmojiPress={() => setEmojiPickerList(item)}
                      highlighted={item.id === highlightedListId}
                    />
                  ))}
                  {pinnedLists.length % 2 !== 0 && <View style={styles.tileWrap} />}
                </View>
              </>
            )}
            {/* ── Gedeeld ── */}
            {sharedLists.length > 0 && (
              <>
                <View style={{ paddingHorizontal: 2, paddingBottom: 10, paddingTop: pinnedLists.length > 0 ? 16 : 2 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8 }}>Gedeeld</Text>
                </View>
                <View style={styles.tileRow}>
                  {sharedLists.map((item, index) => (
                    <AnimatedCard key={item.id} item={item} index={pinnedLists.length + index}
                      onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
                      onDelete={() => deleteList(item.id, item.name, false, !!(item as any).shared_with_me)}
                      onEmojiPress={(item as any).shared_with_me
                        ? () => showToast('Alleen de eigenaar kan de emoji aanpassen.', 'info')
                        : () => setEmojiPickerList(item)}
                      highlighted={item.id === highlightedListId}
                    />
                  ))}
                  {sharedLists.length % 2 !== 0 && <View style={styles.tileWrap} />}
                </View>
              </>
            )}
            {/* ── Mijn lijsten ── */}
            {(activeLists.length > 0 || doneLists.length > 0) && (
              <>
                <View style={{ paddingHorizontal: 2, paddingBottom: 10, paddingTop: (pinnedLists.length > 0 || sharedLists.length > 0) ? 16 : 2 }}>
                  <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8 }}>Mijn lijsten</Text>
                </View>
                {activeLists.length > 0 && (
                  <View style={styles.tileRow}>
                    {activeLists.map((item, index) => (
                      <AnimatedCard key={item.id} item={item} index={pinnedLists.length + sharedLists.length + index}
                        onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
                        onDelete={() => deleteList(item.id, item.name, false, false)}
                        onEmojiPress={() => setEmojiPickerList(item)}
                        highlighted={item.id === highlightedListId}
                      />
                    ))}
                    {activeLists.length % 2 !== 0 && <View style={styles.tileWrap} />}
                  </View>
                )}
                {doneLists.length > 0 && (
                  <>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 8, paddingBottom: 14, gap: 10 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: colors.gray100 }} />
                      <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8 }}>Klaar ({doneLists.length})</Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: colors.gray100 }} />
                    </View>
                    <View style={styles.tileRow}>
                      {doneLists.map((item, index) => (
                        <AnimatedCard key={item.id} item={item} index={pinnedLists.length + sharedLists.length + activeLists.length + index}
                          onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
                          onDelete={() => deleteList(item.id, item.name, false, false)}
                          onEmojiPress={() => setEmojiPickerList(item)}
                          highlighted={item.id === highlightedListId}
                        />
                      ))}
                      {doneLists.length % 2 !== 0 && <View style={styles.tileWrap} />}
                    </View>
                  </>
                )}
              </>
            )}
          </ScrollView>
            )}
          </>
        )
      )}

      {/* Notes view */}
      {activeTab === 'notes' && (
        <ScrollView
          ref={notesScrollRef as any}
          style={{ flex: 1, backgroundColor: colors.offWhite }}
          contentContainerStyle={{ paddingBottom: TAB_BAR_CLEARANCE + 40 }}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotes(); }} tintColor={Colors.yellow} colors={[Colors.yellow]} />}
        >
          {/* Search bar */}
          {notes.length > 0 && (
            <View style={[styles.searchBar, searchFocused && styles.searchBarFocused, { marginHorizontal: 16, marginTop: 12, marginBottom: 8, backgroundColor: colors.gray100, borderColor: searchFocused ? Colors.yellow + '60' : colors.gray200 }]}>
              <Ionicons name="search-outline" size={15} color={searchFocused ? Colors.yellow : colors.gray400} />
              <TextInput
                style={[styles.searchInput, { color: colors.black }]}
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
          {/* Category filter chips */}
          {noteCats.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ height: 46 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8, alignItems: 'center', height: 46 }}>
              <TouchableOpacity
                onPress={() => setSelectedNoteCatId(null)}
                style={[rStyles.chip, { backgroundColor: !selectedNoteCatId ? colors.black : colors.white, borderColor: colors.gray200 }]}
              >
                <Text style={[rStyles.chipText, { color: !selectedNoteCatId ? colors.white : colors.gray400 }]}>Alle</Text>
              </TouchableOpacity>
              {noteCats.map(cat => (
                <TouchableOpacity
                  key={cat.id}
                  onPress={() => setSelectedNoteCatId(selectedNoteCatId === cat.id ? null : cat.id)}
                  onLongPress={() => Alert.alert(`${cat.emoji} ${cat.name}`, 'Categorie verwijderen?', [
                    { text: 'Annuleer', style: 'cancel' },
                    { text: 'Verwijder', style: 'destructive', onPress: async () => {
                      await apiFetch(`/notes/categories/${cat.id}?user_id=${user?.id}`, { method: 'DELETE' });
                      setNoteCats(prev => prev.filter(c => c.id !== cat.id));
                      if (selectedNoteCatId === cat.id) setSelectedNoteCatId(null);
                    }},
                  ])}
                  style={[rStyles.chip, { backgroundColor: selectedNoteCatId === cat.id ? cat.color : colors.white, borderColor: selectedNoteCatId === cat.id ? cat.color : colors.gray200 }]}
                >
                  <Text style={{ fontSize: 13 }}>{cat.emoji}</Text>
                  <Text style={[rStyles.chipText, { color: selectedNoteCatId === cat.id ? '#fff' : colors.black }]}>{cat.name}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={() => { setNewNoteCatName(''); setNewNoteCatEmoji('📁'); setNewNoteCatVisible(true); }}
                style={[rStyles.chip, { backgroundColor: colors.white, borderColor: colors.gray200, borderStyle: 'dashed' }]}
              >
                <Ionicons name="add" size={14} color={colors.gray400} />
                <Text style={[rStyles.chipText, { color: colors.gray400 }]}>Nieuw</Text>
              </TouchableOpacity>
            </ScrollView>
          )}
          {/* Notes grid or empty state */}
          {filteredNotes.length === 0 ? (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingHorizontal: 24 }}>
              <View style={[styles.emptyIcon, { backgroundColor: '#FFF3E0' }]}>
                <Text style={{ fontSize: 32 }}>💡</Text>
              </View>
              <Text style={[styles.emptyTitle, { color: colors.black }]}>{search ? 'Geen resultaten' : 'Nog geen notities'}</Text>
              {!search && (
                <>
                  <Text style={[styles.emptyText, { color: colors.gray400 }]}>
                    Stuur een bericht naar de bot:{'\n'}
                    <Text style={styles.exampleMsg}>"onthoud: na 22u geen koffie meer"</Text>
                  </Text>
                  <TouchableOpacity
                    onPress={() => Linking.openURL(`whatsapp://send?phone=${BOT_NUMBER}&text=onthoud:`)}
                    style={styles.emptyActionBtn}
                    activeOpacity={0.8}
                  >
                    <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={styles.emptyActionBtnGrad}>
                      <Ionicons name="logo-whatsapp" size={16} color={Colors.black} />
                      <Text style={styles.emptyActionBtnText}>Open WhatsApp</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              )}
            </View>
          ) : (
            <View style={styles.noteGrid}>
              {Array.from({ length: Math.ceil(filteredNotes.length / 2) }, (_, rowIdx) => {
                const left = filteredNotes[rowIdx * 2];
                const right = filteredNotes[rowIdx * 2 + 1];
                return (
                  <View key={rowIdx} style={styles.noteRow}>
                    <NoteCard item={left} index={rowIdx * 2} search={search} onPress={() => setSelectedNote(left)} category={noteCats.find(c => c.id === left.category_id)} />
                    {right
                      ? <NoteCard item={right} index={rowIdx * 2 + 1} search={search} onPress={() => setSelectedNote(right)} category={noteCats.find(c => c.id === right.category_id)} />
                      : <View style={{ flex: 1 }} />}
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
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
                        await apiFetch(`/receipt-categories/${user?.id}/${cat.id}`, { method: 'DELETE' });
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

            {receiptError ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#EF4444' }}>Kon bonnetjes niet laden.</Text>
                <TouchableOpacity onPress={fetchReceipts} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.yellow, borderRadius: 20 }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: colors.black }}>Opnieuw proberen</Text>
                </TouchableOpacity>
              </View>
            ) : filteredReceipts.length === 0 ? (
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
                ref={receiptsScrollRef}
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
                        { text: 'Verwijderen', style: 'destructive', onPress: () => {
                          if (pendingReceiptDelete) {
                            if (pendingReceiptDeleteTimer.current) clearTimeout(pendingReceiptDeleteTimer.current);
                            apiFetch(`/receipts/${user?.id}/${pendingReceiptDelete.id}`, { method: 'DELETE' }).catch(() => {});
                            setPendingReceiptDelete(null);
                          }
                          setReceipts(prev => prev.filter(r => r.id !== item.id));
                          setPendingReceiptDelete(item);
                          pendingReceiptDeleteTimer.current = setTimeout(() => {
                            apiFetch(`/receipts/${user?.id}/${item.id}`, { method: 'DELETE' }).catch(() => {});
                            setPendingReceiptDelete(null);
                          }, 4000);
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
      <Modal visible={!!selectedNote} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSelectedNote(null); setEditingNote(false); }}>
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => { setSelectedNote(null); setEditingNote(false); }} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="close" size={18} color={colors.black} />
            </TouchableOpacity>
            {editingNote ? (
              <Text style={[styles.modalDate, { color: colors.gray400 }]}>Bewerken</Text>
            ) : (
              <Text style={[styles.modalDate, { color: colors.gray400 }]}>
                {selectedNote ? new Date(selectedNote.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' }) : ''}
              </Text>
            )}
            {editingNote ? (
              <TouchableOpacity onPress={saveNoteEdit} style={[styles.closeBtn, { backgroundColor: Colors.yellow }]}>
                <Ionicons name="checkmark" size={18} color={Colors.black} />
              </TouchableOpacity>
            ) : (
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => { setEditNoteTitle(selectedNote?.title ?? ''); setEditNoteBody(selectedNote?.body ?? ''); setEditNoteCatId(selectedNote?.category_id ?? null); setEditingNote(true); }}
                  style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
                >
                  <Ionicons name="pencil-outline" size={16} color={colors.black} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => selectedNote && Share.share({ message: `${selectedNote.title ? selectedNote.title + '\n\n' : ''}${selectedNote.body}` })}
                  style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
                >
                  <Ionicons name="share-outline" size={18} color={colors.black} />
                </TouchableOpacity>
              </View>
            )}
          </View>
          {editingNote ? (
            <>
              {/* Category picker — above keyboard so always reachable */}
              <View style={{ borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.gray100 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: 'center' }} keyboardShouldPersistTaps="always">
                  <TouchableOpacity
                    onPress={() => setEditNoteCatId(null)}
                    style={[rStyles.chip, { backgroundColor: !editNoteCatId ? colors.black : colors.white, borderColor: colors.gray200 }]}
                  >
                    <Text style={[rStyles.chipText, { color: !editNoteCatId ? colors.white : colors.gray400 }]}>Geen</Text>
                  </TouchableOpacity>
                  {noteCats.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => setEditNoteCatId(editNoteCatId === cat.id ? null : cat.id)}
                      style={[rStyles.chip, { backgroundColor: editNoteCatId === cat.id ? cat.color : colors.white, borderColor: editNoteCatId === cat.id ? cat.color : colors.gray200 }]}
                    >
                      <Text style={{ fontSize: 13 }}>{cat.emoji}</Text>
                      <Text style={[rStyles.chipText, { color: editNoteCatId === cat.id ? '#fff' : colors.black }]}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => { setNewNoteCatName(''); setNewNoteCatEmoji('📁'); setNewNoteCatVisible(true); }}
                    style={[rStyles.chip, { backgroundColor: colors.white, borderColor: colors.gray200, borderStyle: 'dashed' }]}
                  >
                    <Ionicons name="add" size={14} color={colors.gray400} />
                    <Text style={[rStyles.chipText, { color: colors.gray400 }]}>Nieuw</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
              <ScrollView contentContainerStyle={[styles.modalContent, { paddingBottom: noteEditKeyboardHeight + 24 }]} keyboardShouldPersistTaps="handled">
                <TextInput
                  style={[styles.modalTitle, { color: colors.black, borderBottomWidth: 1, borderBottomColor: colors.gray100, marginBottom: 16, padding: 0 }]}
                  value={editNoteTitle}
                  onChangeText={setEditNoteTitle}
                  placeholder="Titel (optioneel)"
                  placeholderTextColor={colors.gray400}
                  selectionColor={Colors.yellow}
                  multiline={false}
                />
                <TextInput
                  style={[styles.modalBody, { color: colors.gray800, minHeight: 120, textAlignVertical: 'top', padding: 0 }]}
                  value={editNoteBody}
                  onChangeText={setEditNoteBody}
                  placeholder="Notitie..."
                  placeholderTextColor={colors.gray400}
                  selectionColor={Colors.yellow}
                  multiline
                  autoFocus
                />
              </ScrollView>
            </>
          ) : (
            <ScrollView contentContainerStyle={styles.modalContent}>
              {selectedNote?.title && <Text style={[styles.modalTitle, { color: colors.black }]}>{selectedNote.title}</Text>}
              <Text style={[styles.modalBody, { color: colors.gray800 }]}>{selectedNote?.body}</Text>
            </ScrollView>
          )}
          {!editingNote && (
            <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 }}>
              <TouchableOpacity
                onPress={() => selectedNote && Alert.alert('Notitie verwijderen?', 'Dit kan niet ongedaan worden gemaakt.', [
                  { text: 'Annuleer', style: 'cancel' },
                  { text: 'Verwijder', style: 'destructive', onPress: () => selectedNote && deleteNote(selectedNote.id) },
                ])}
                style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: Radius.md, backgroundColor: '#FEE2E2' }}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={16} color="#EF4444" />
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#EF4444' }}>Verwijder notitie</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* Undo snackbar */}
      {listUndoVisible && (
        <Animated.View style={[undoStyles.snackbar, { bottom: insets.bottom + 90, opacity: undoOpacity, transform: [{ translateY: undoSlide }] }]}>
          <Text style={undoStyles.snackbarText}>"{pendingListDelete?.listName}" verwijderd</Text>
          <TouchableOpacity onPress={undoListDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={undoStyles.undoBtn}>Ongedaan maken</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {pendingReceiptDelete && (
        <Animated.View style={[undoStyles.snackbar, { bottom: insets.bottom + 90 }]}>
          <Text style={undoStyles.snackbarText}>"{pendingReceiptDelete.store ?? 'Bonnetje'}" verwijderd</Text>
          <TouchableOpacity
            onPress={() => {
              if (pendingReceiptDeleteTimer.current) clearTimeout(pendingReceiptDeleteTimer.current);
              setReceipts(prev => [pendingReceiptDelete, ...prev]);
              setPendingReceiptDelete(null);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={undoStyles.undoBtn}>Ongedaan maken</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

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
          <ScrollView scrollEnabled={!isDraggingReorder} contentContainerStyle={{ padding: 16, gap: 8 }}>
            {reorderList.map((item, index) => {
              const isActive = reorderDragIndex === index;
              const isTarget = reorderTargetIndex === index && !isActive;
              const panResponder = PanResponder.create({
                onStartShouldSetPanResponder: () => true,
                onPanResponderGrant: () => {
                  reorderDragIndexRef.current = index;
                  reorderTargetIndexRef.current = index;
                  setReorderDragIndex(index);
                  setReorderTargetIndex(index);
                  setIsDraggingReorder(true);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                },
                onPanResponderMove: (_, g) => {
                  const newTarget = Math.min(reorderList.length - 1, Math.max(0, Math.round(index + g.dy / REORDER_ROW_H)));
                  if (newTarget !== reorderTargetIndexRef.current) {
                    reorderTargetIndexRef.current = newTarget;
                    setReorderTargetIndex(newTarget);
                    Haptics.selectionAsync();
                  }
                },
                onPanResponderRelease: () => {
                  const from = reorderDragIndexRef.current;
                  const to = reorderTargetIndexRef.current;
                  if (from !== null && to !== null && from !== to) {
                    setReorderList(prev => {
                      const next = [...prev];
                      const [moved] = next.splice(from, 1);
                      next.splice(to, 0, moved);
                      return next;
                    });
                  }
                  reorderDragIndexRef.current = null;
                  reorderTargetIndexRef.current = null;
                  setReorderDragIndex(null);
                  setReorderTargetIndex(null);
                  setIsDraggingReorder(false);
                },
                onPanResponderTerminate: () => {
                  reorderDragIndexRef.current = null;
                  reorderTargetIndexRef.current = null;
                  setReorderDragIndex(null);
                  setReorderTargetIndex(null);
                  setIsDraggingReorder(false);
                },
              });
              return (
                <View key={item.id} style={[reorderStyles.row, {
                  backgroundColor: isActive ? colors.gray100 : isTarget ? Colors.yellow + '18' : colors.offWhite,
                  borderWidth: isTarget ? 1.5 : 0,
                  borderColor: Colors.yellow,
                  opacity: isActive ? 0.55 : 1,
                }]}>
                  <View {...panResponder.panHandlers} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                    <Ionicons name="menu" size={20} color={colors.gray400} />
                  </View>
                  <Text style={{ fontSize: 20 }}>{item.emoji || '📝'}</Text>
                  <Text style={[reorderStyles.name, { color: colors.black }]} numberOfLines={1}>{item.name}</Text>
                  <TouchableOpacity onPress={() => { duplicateList(item); setReorderModalVisible(false); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ padding: 4 }}>
                    <Ionicons name="copy-outline" size={16} color={colors.gray400} />
                  </TouchableOpacity>
                </View>
              );
            })}
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
      {activeTab === 'lists' && lists.length > 0 && (
        <TouchableOpacity
          style={[fabStyles.fab, { bottom: insets.bottom + 90 }]}
          onPress={() => { setNewListName(''); setNewListModalVisible(true); }}
          activeOpacity={0.85}
        >
          <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={fabStyles.fabGrad}>
            <Ionicons name="add" size={26} color={Colors.black} />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* New note FAB */}
      {activeTab === 'notes' && (
        <TouchableOpacity
          style={[fabStyles.fab, { bottom: insets.bottom + 90 }]}
          onPress={() => { setAddNoteTitle(''); setAddNoteBody(''); setAddNoteCatId(selectedNoteCatId); setAddNoteVisible(true); }}
          activeOpacity={0.85}
        >
          <LinearGradient colors={[Colors.yellow, Colors.yellowDark]} style={fabStyles.fabGrad}>
            <Ionicons name="add" size={26} color={Colors.black} />
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* New note modal */}
      <Modal visible={addNoteVisible} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setAddNoteVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={{ flex: 1, backgroundColor: colors.white }}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
              <TouchableOpacity onPress={() => setAddNoteVisible(false)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
                <Ionicons name="close" size={18} color={colors.gray400} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.black }}>Nieuwe notitie</Text>
              <TouchableOpacity
                onPress={async () => {
                  if (!user || !addNoteBody.trim() || addNoteSaving) return;
                  setAddNoteSaving(true);
                  try {
                    const res = await apiFetch(`/notes?user_id=${user.id}`, {
                      method: 'POST',
                      body: JSON.stringify({ title: addNoteTitle.trim() || null, body: addNoteBody.trim(), category_id: addNoteCatId }),
                    });
                    const data = await res.json().catch(() => null);
                    if (data?.id) {
                      const newNote: Note = { id: data.id, user_id: user.id, title: addNoteTitle.trim() || null, body: addNoteBody.trim(), created_at: new Date().toISOString(), category_id: addNoteCatId };
                      setNotes(prev => [newNote, ...prev]);
                    }
                  } catch {}
                  setAddNoteSaving(false);
                  setAddNoteVisible(false);
                }}
                disabled={!addNoteBody.trim() || addNoteSaving}
                style={[styles.closeBtn, { backgroundColor: Colors.yellow, opacity: addNoteBody.trim() ? 1 : 0.4 }]}
              >
                {addNoteSaving ? <ActivityIndicator size="small" color={Colors.black} /> : <Ionicons name="checkmark" size={18} color={Colors.black} />}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 28, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
              <TextInput
                style={{ fontFamily: 'Inter_700Bold', fontSize: 26, color: colors.black, marginBottom: 16, letterSpacing: -0.6 }}
                value={addNoteTitle}
                onChangeText={setAddNoteTitle}
                placeholder="Titel (optioneel)"
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
                returnKeyType="next"
                autoFocus
              />
              <TextInput
                style={{ fontFamily: 'Inter_400Regular', fontSize: 17, color: colors.black, lineHeight: 28, minHeight: 160 }}
                value={addNoteBody}
                onChangeText={setAddNoteBody}
                placeholder="Schrijf hier je notitie..."
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
                multiline
                textAlignVertical="top"
              />
              {/* Category picker */}
              <View style={{ marginTop: 24 }}>
                <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 13, color: colors.gray400, marginBottom: 10 }}>CATEGORIE</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, alignItems: 'center' }}>
                  <TouchableOpacity
                    onPress={() => setAddNoteCatId(null)}
                    style={[rStyles.chip, { backgroundColor: !addNoteCatId ? colors.black : colors.white, borderColor: colors.gray200 }]}
                  >
                    <Text style={[rStyles.chipText, { color: !addNoteCatId ? colors.white : colors.gray400 }]}>Geen</Text>
                  </TouchableOpacity>
                  {noteCats.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => setAddNoteCatId(addNoteCatId === cat.id ? null : cat.id)}
                      style={[rStyles.chip, { backgroundColor: addNoteCatId === cat.id ? cat.color : colors.white, borderColor: addNoteCatId === cat.id ? cat.color : colors.gray200 }]}
                    >
                      <Text style={{ fontSize: 13 }}>{cat.emoji}</Text>
                      <Text style={[rStyles.chipText, { color: addNoteCatId === cat.id ? '#fff' : colors.black }]}>{cat.name}</Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => { setNewNoteCatName(''); setNewNoteCatEmoji('📁'); setNewNoteCatVisible(true); }}
                    style={[rStyles.chip, { backgroundColor: colors.white, borderColor: colors.gray200, borderStyle: 'dashed' }]}
                  >
                    <Ionicons name="add" size={14} color={colors.gray400} />
                    <Text style={[rStyles.chipText, { color: colors.gray400 }]}>Nieuw</Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* New note category modal */}
      <Modal visible={newNoteCatVisible} transparent animationType="slide" onRequestClose={() => setNewNoteCatVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <Pressable style={sheetStyles.overlay} onPress={() => setNewNoteCatVisible(false)}>
            <Pressable style={[sheetStyles.sheet, { backgroundColor: colors.white, paddingBottom: insets.bottom > 0 ? insets.bottom + 16 : 32 }]} onPress={() => {}}>
              <View style={sheetStyles.handle} />
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <Text style={[sheetStyles.title, { color: colors.black, marginBottom: 0 }]}>Nieuwe categorie</Text>
                <TouchableOpacity onPress={() => setNewNoteCatVisible(false)} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={16} color={colors.gray600} />
                </TouchableOpacity>
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                <TouchableOpacity
                  onPress={() => {
                    const emojis = ['📁','📝','💡','🔥','⭐','❤️','🎯','🧠','💼','🎉','🌿','✈️','🏠','🛒','📚'];
                    const idx = emojis.indexOf(newNoteCatEmoji);
                    setNewNoteCatEmoji(emojis[(idx + 1) % emojis.length]);
                  }}
                  style={{ width: 52, height: 52, borderRadius: 14, backgroundColor: colors.gray100, justifyContent: 'center', alignItems: 'center' }}
                >
                  <Text style={{ fontSize: 26 }}>{newNoteCatEmoji}</Text>
                </TouchableOpacity>
                <View style={[fabStyles.inputWrap, { flex: 1, backgroundColor: colors.gray100 }]}>
                  <TextInput
                    style={[fabStyles.input, { color: colors.black }]}
                    value={newNoteCatName}
                    onChangeText={setNewNoteCatName}
                    placeholder="Naam van de categorie..."
                    placeholderTextColor={colors.gray400}
                    autoFocus
                    returnKeyType="done"
                    selectionColor={Colors.yellow}
                    onSubmitEditing={async () => {
                      if (!newNoteCatName.trim() || newNoteCatSaving || !user) return;
                      setNewNoteCatSaving(true);
                      try {
                        const res = await apiFetch(`/notes/categories?user_id=${user.id}`, {
                          method: 'POST',
                          body: JSON.stringify({ name: newNoteCatName.trim(), emoji: newNoteCatEmoji, color: '#FCC10C' }),
                        });
                        const cat = await res.json().catch(() => null);
                        if (cat?.id) setNoteCats(prev => [...prev, cat]);
                      } catch {}
                      setNewNoteCatSaving(false);
                      setNewNoteCatVisible(false);
                    }}
                  />
                </View>
              </View>
              <TouchableOpacity
                style={[sheetStyles.destructiveBtn, { backgroundColor: newNoteCatName.trim() ? Colors.yellow : colors.gray200 }]}
                disabled={!newNoteCatName.trim() || newNoteCatSaving}
                activeOpacity={0.85}
                onPress={async () => {
                  if (!newNoteCatName.trim() || newNoteCatSaving || !user) return;
                  setNewNoteCatSaving(true);
                  try {
                    const res = await apiFetch(`/notes/categories?user_id=${user.id}`, {
                      method: 'POST',
                      body: JSON.stringify({ name: newNoteCatName.trim(), emoji: newNoteCatEmoji, color: '#FCC10C' }),
                    });
                    const cat = await res.json().catch(() => null);
                    if (cat?.id) setNoteCats(prev => [...prev, cat]);
                  } catch {}
                  setNewNoteCatSaving(false);
                  setNewNoteCatVisible(false);
                }}
              >
                {newNoteCatSaving ? <ActivityIndicator size="small" color={Colors.black} /> : <Text style={[sheetStyles.destructiveBtnText, { color: Colors.black }]}>Aanmaken</Text>}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

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

      {/* Emoji picker modal */}
      <Modal visible={!!emojiPickerList} transparent animationType="fade" onRequestClose={() => setEmojiPickerList(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 }} onPress={() => setEmojiPickerList(null)}>
          <Pressable style={{ backgroundColor: colors.white, borderRadius: 24, padding: 20, width: '100%', maxWidth: 360 }} onPress={() => {}}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.black }}>Kies een icoon</Text>
              <TouchableOpacity onPress={() => setEmojiPickerList(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={22} color={colors.gray400} />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {[
                '📝','✅','🛒','🍳','🍕','🥗','🍰','☕','🍎','🥦',
                '🏠','🛋️','🧹','🔧','🪴','💡','🔑','📦','🖥️','📱',
                '💼','📚','✏️','🎯','📊','💰','🧾','💳','📈','🗂️',
                '❤️','⭐','🎉','🎁','🎵','🎬','📷','✈️','🏖️','⚽',
                '🐶','🐱','🌸','🌿','🌙','☀️','🌈','❄️','🔥','💎',
                '🏋️','🧘','🚴','🧠','💪','🩺','💊','🧪','🔬','🎓',
              ].map(e => (
                <TouchableOpacity
                  key={e}
                  onPress={() => emojiPickerList && saveEmoji(emojiPickerList.id, e)}
                  style={{
                    width: 48, height: 48, borderRadius: 12,
                    backgroundColor: emojiPickerList?.emoji === e ? Colors.yellow + '30' : colors.gray100,
                    justifyContent: 'center', alignItems: 'center',
                    borderWidth: emojiPickerList?.emoji === e ? 2 : 0,
                    borderColor: Colors.yellow,
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={{ fontSize: 24 }}>{e}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Toast {...toastProps} />
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

  // ── Clean warm header ──
  header: { paddingHorizontal: 22, paddingBottom: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  headerGreet: { fontFamily: 'Inter_400Regular', fontSize: 14.5, marginBottom: 3, letterSpacing: -0.1 },
  headerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 27, textTransform: 'uppercase', letterSpacing: 0.4, lineHeight: 30 },

  // ── Search bar ──
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1,
  },
  searchBarFocused: {},
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15 },

  // ── Top tabs ──
  tabToggleWrap: { flexDirection: 'row', paddingHorizontal: 22, paddingTop: 14, paddingBottom: 0, gap: 24 },
  tabTextBtn: { alignItems: 'center', paddingBottom: 11 },
  tabTextLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 16, letterSpacing: -0.2 },
  tabTextUnderline: { height: 2.5, width: '100%', borderRadius: 3, position: 'absolute', bottom: 0 },

  skeletonList: { padding: 20 },
  tileGrid: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: TAB_BAR_CLEARANCE },
  sortSticky: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 10 },
  tileRow: { flexDirection: 'row', flexWrap: 'wrap' },
  tileWrap: { width: '50%', paddingHorizontal: 6, marginBottom: 12 },

  // ── List tile card (white surface + tone icon) ──
  tile: { borderRadius: Radius.lg, padding: 16, height: 168, justifyContent: 'space-between' },
  tileIconBox: { width: 42, height: 42, borderRadius: 13, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  tileEmoji: { fontSize: 22 },
  tileBottom: {},
  tileName: { fontFamily: 'Inter_700Bold', fontSize: 17, letterSpacing: -0.3, marginBottom: 5 },
  tileCountRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  tileCount: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  typeBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radius.pill },
  typeBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.4 },
  tileProgressBg: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 5, borderBottomLeftRadius: Radius.lg - 1, borderBottomRightRadius: Radius.lg - 1, overflow: 'hidden' },
  tileProgressFill: { height: 5 },
  retryBtn: { borderRadius: Radius.pill, paddingVertical: 13, paddingHorizontal: 28, marginTop: 8 },
  retryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.black },

  noteGrid: { padding: 12, paddingTop: 8 },
  noteRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  noteCard: { flex: 1, borderRadius: Radius.lg, padding: 17, minHeight: 130, ...Shadow.card },
  noteCardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 15.5, marginBottom: 7, letterSpacing: -0.2, lineHeight: 21 },
  noteCardBody: { fontFamily: 'Inter_400Regular', fontSize: 13.5, lineHeight: 20, flex: 1 },
  noteCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  noteCardTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: Radius.pill },
  noteCardTagText: { fontFamily: 'Inter_600SemiBold', fontSize: 11.5 },
  noteCardDate: { fontFamily: 'Inter_400Regular', fontSize: 12.5 },

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


const reorderStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg },
  name: { flex: 1, fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
