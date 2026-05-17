import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Animated,
  Pressable,
  Platform,
  TextInput,
  Modal,
  ScrollView,
  SafeAreaView,
  Linking,
  Image,
  Alert,
} from 'react-native';
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
import { Colors, Shadow, Radius } from '@/constants/Design';
import { SkeletonListCard } from '@/components/SkeletonCard';

const BOT_NUMBER = '31684965318';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

// ── Lists ──────────────────────────────────────────────────────────────────────

// Full-card solid colors — text color adapts per background
const TILE_ACCENTS  = ['#FCC10C', '#1A1A1A', '#E8734A', '#4A6FA5'];
const TILE_TEXT_FG  = ['#0A0A0A', '#FFFFFF',  '#FFFFFF',  '#FFFFFF'];

function AnimatedCard({ item, index, onPress }: { item: List & { item_count: number }; index: number; onPress: () => void; colors: any }) {
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  const bg  = TILE_ACCENTS[index % TILE_ACCENTS.length];
  const fg  = TILE_TEXT_FG[index % TILE_TEXT_FG.length];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 320, delay: index * 55, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, delay: index * 55, tension: 90, friction: 13, useNativeDriver: true }),
    ]).start();
  }, []);

  const typeLabel = item.list_type === 'links' ? 'Links' : item.list_type === 'tips' ? 'Tips' : null;

  return (
    <Animated.View style={[styles.tileWrap, { opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale }] }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        style={[styles.tile, { backgroundColor: bg }]}
      >
        <Text style={styles.tileEmoji}>{item.emoji || '📝'}</Text>
        <View style={styles.tileBottom}>
          <Text style={[styles.tileName, { color: fg }]} numberOfLines={2}>{item.name}</Text>
          <View style={styles.tileCountRow}>
            <Text style={[styles.tileCount, { color: fg, opacity: 0.65 }]}>
              {item.item_count} {item.item_count === 1 ? 'item' : 'items'}
            </Text>
            {typeLabel && (
              <View style={[styles.typeBadge, { backgroundColor: 'rgba(0,0,0,0.15)' }]}>
                <Text style={[styles.typeBadgeText, { color: fg }]}>{typeLabel}</Text>
              </View>
            )}
          </View>
        </View>
      </Pressable>
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
            {new Date(item.created_at).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' })}
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
  const [lists, setLists] = useState<(List & { item_count: number })[]>([]);
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
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);

  const showBanner = settings.onboarding_done && !settings.getting_started_dismissed;

  const fetchLists = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); setRefreshing(false); return; }
    const { data } = await supabase
      .from('lists').select('id, name, emoji, sort_order, list_type, list_items(count)')
      .eq('user_id', user.id).order('sort_order', { ascending: true });
    if (data) setLists(data.map((l: any) => ({ ...l, item_count: l.list_items?.[0]?.count ?? 0 })));
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
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items' }, fetchLists)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, fetchNotes)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user, fetchLists, fetchNotes]);

  const filteredNotes = notes.filter(n =>
    n.title?.toLowerCase().includes(search.toLowerCase()) ||
    n.body.toLowerCase().includes(search.toLowerCase())
  );

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

  useEffect(() => { if (settings.receipts_enabled) fetchReceipts(); }, [fetchReceipts, settings.receipts_enabled]);

  const showNotesTab     = settings.notes_enabled;
  const showReceiptsTab  = settings.receipts_enabled;

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      {/* Banner */}
      <View style={[styles.banner, { paddingTop: insets.top + 40 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
        <Text style={styles.bannerEyebrow}>
          {settings.user_name ? `Goedemorgen, ${settings.user_name} 👋` : 'Goedemorgen 👋'}
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
            <Ionicons name="search-outline" size={15} color={searchFocused ? Colors.yellow : '#555'} />
            <TextInput
              style={styles.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Zoeken in notities..."
              placeholderTextColor="#444"
              selectionColor={Colors.yellow}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close-circle-outline" size={16} color="#666" />
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Toggle */}
      {(showNotesTab || showReceiptsTab) && (
        <View style={[styles.tabToggleWrap, { backgroundColor: colors.offWhite }]}>
          <TouchableOpacity style={styles.tabTextBtn} onPress={() => setActiveTab('lists')}>
            <Text style={[styles.tabTextLabel, { color: activeTab === 'lists' ? colors.black : colors.gray400 }]}>Lijsten</Text>
            {activeTab === 'lists' && <View style={[styles.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
          </TouchableOpacity>
          {showNotesTab && (
            <TouchableOpacity style={styles.tabTextBtn} onPress={() => setActiveTab('notes')}>
              <Text style={[styles.tabTextLabel, { color: activeTab === 'notes' ? colors.black : colors.gray400 }]}>Notities</Text>
              {activeTab === 'notes' && <View style={[styles.tabTextUnderline, { backgroundColor: Colors.yellow }]} />}
            </TouchableOpacity>
          )}
          {showReceiptsTab && (
            <TouchableOpacity style={styles.tabTextBtn} onPress={() => { setActiveTab('receipts'); fetchReceipts(); }}>
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
        ) : lists.length === 0 ? (
          <ScrollView
            style={{ backgroundColor: colors.offWhite }}
            contentContainerStyle={styles.emptyScrollContent}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); }} tintColor={Colors.yellow} />}
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
              <View style={[styles.emptyIcon, { backgroundColor: colors.gray100 }]}>
                <Ionicons name="layers-outline" size={32} color={colors.gray400} />
              </View>
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
          <FlatList
            data={lists}
            keyExtractor={(l) => l.id}
            numColumns={2}
            columnWrapperStyle={styles.tileRow}
            contentContainerStyle={[styles.tileGrid, showBanner && { paddingTop: 0 }]}
            style={{ backgroundColor: colors.offWhite }}
            ListHeaderComponent={showBanner ? (
              <GettingStartedBanner
                userId={user?.id ?? null}
                onDismiss={() => updateSetting('getting_started_dismissed', true)}
                colors={colors}
              />
            ) : null}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); }} tintColor={Colors.yellow} />}
            renderItem={({ item, index }) => (
              <AnimatedCard
                item={item} index={index} colors={colors}
                onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji, list_type: item.list_type ?? 'checklist' } })}
              />
            )}
          />
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
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotes(); }} tintColor={Colors.yellow} />}
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
                {/* All chip */}
                <TouchableOpacity
                  onPress={() => setSelectedCatId(null)}
                  style={[rStyles.chip, { backgroundColor: !selectedCatId ? colors.black : colors.white, borderColor: colors.gray200 }]}
                >
                  <Text style={[rStyles.chipText, { color: !selectedCatId ? colors.white : colors.gray400 }]}>Alle</Text>
                </TouchableOpacity>
                {/* Category chips */}
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
                {/* Add category */}
                <TouchableOpacity
                  onPress={() => { setNewCatName(''); setNewCatEmoji(''); setNewCatColor(CAT_COLORS[0]); setCatModalVisible(true); }}
                  style={[rStyles.chip, { backgroundColor: colors.white, borderColor: colors.gray200, borderStyle: 'dashed' }]}
                >
                  <Ionicons name="add" size={15} color={colors.gray400} />
                  <Text style={[rStyles.chipText, { color: colors.gray400 }]}>Nieuw</Text>
                </TouchableOpacity>
                {/* PDF export */}
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
              {/* Category total */}
              {selectedCatId && (
                <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 12, color: colors.gray400 }}>
                    {filteredReceipts.length} bonnetjes · totaal <Text style={{ fontFamily: 'Inter_700Bold', color: colors.black }}>€{catTotal.toFixed(2)}</Text>
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
                refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchReceipts().then(() => setRefreshing(false)); }} tintColor={Colors.yellow} />}
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
                              €{Number(item.total).toFixed(2)}
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
                  {/* Header info */}
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
                        €{Number(detailReceipt.total).toFixed(2)}
                      </Text>
                    )}
                  </View>
                  {/* Description */}
                  {detailReceipt.description && (
                    <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray400, lineHeight: 20 }}>
                      {detailReceipt.description}
                    </Text>
                  )}
                  {/* Items */}
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
                              €{Number(item.price).toFixed(2)}
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
    </View>
  );
}

const rStyles = StyleSheet.create({
  chip:      { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, borderWidth: 1, borderColor: '#E0E0E0' },
  chipText:  { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  assignRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: Radius.lg },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: { paddingHorizontal: 32, paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  bannerEyebrow: { fontFamily: 'Inter_300Light', fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 6 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 32, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16 },
  bannerStats: { flexDirection: 'row', gap: 10, marginTop: 4 },
  statTile: {
    paddingHorizontal: 18, paddingVertical: 12,
    backgroundColor: '#FFFFFF12', borderRadius: Radius.md,
    borderWidth: 1, borderColor: '#FFFFFF18', minWidth: 90,
  },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum: { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1 },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchBarFocused: { borderColor: Colors.yellow + '60' },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.white },

  tabToggleWrap: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 16, paddingBottom: 4, gap: 20 },
  tabTextBtn: { alignItems: 'center', paddingBottom: 8 },
  tabTextLabel: { fontFamily: 'Inter_700Bold', fontSize: 16, letterSpacing: -0.3 },
  tabTextUnderline: { height: 3, width: '80%', borderRadius: 2, marginTop: 4 },

  skeletonList: { padding: 16 },
  tileGrid: { padding: 16, paddingBottom: 120 },
  tileRow: { gap: 12, marginBottom: 12 },
  tileWrap: { flex: 1 },
  tile: { flex: 1, borderRadius: Radius.xl, overflow: 'hidden', padding: 18, minHeight: 150, justifyContent: 'space-between', ...Shadow.card },
  tileEmoji: { fontSize: 26, marginBottom: 12 },
  tileBottom: {},
  tileName: { fontFamily: 'Inter_700Bold', fontSize: 15, letterSpacing: -0.2, marginBottom: 6 },
  tileCountRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileCount: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  typeBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: Radius.pill },
  typeBadgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 0.3 },

  noteGrid: { padding: 20, paddingBottom: 120 },
  noteRow: { gap: 10, marginBottom: 10 },
  noteCard: { flex: 1, borderRadius: Radius.lg, padding: 16, minHeight: 130, ...Shadow.card },
  noteCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, marginBottom: 8, letterSpacing: -0.2 },
  noteCardBody: { fontFamily: 'Inter_300Light', fontSize: 13, lineHeight: 19, flex: 1 },
  noteCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
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

  // Getting started banner
  gettingStartedCard: {
    marginHorizontal: 24,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: Radius.lg,
    padding: 16,
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
