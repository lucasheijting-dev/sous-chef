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

// ── Lists ──────────────────────────────────────────────────────────────────────

const CARD_COLORS = [Colors.yellow, Colors.black, '#F0F0F0', Colors.yellow, Colors.black];

function AnimatedCard({ item, index, onPress, colors }: { item: List & { item_count: number }; index: number; onPress: () => void; colors: any }) {
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, delay: index * 60, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, delay: index * 60, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        style={[styles.card, { backgroundColor: colors.white }]}
      >
        <View style={[styles.emojiBox, { backgroundColor: CARD_COLORS[index % CARD_COLORS.length] }]}>
          <Text style={styles.cardEmoji}>{item.emoji || '📝'}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.cardName, { color: colors.black }]}>{item.name}</Text>
          <Text style={[styles.cardCount, { color: colors.gray400 }]}>{item.item_count} {item.item_count === 1 ? 'item' : 'items'}</Text>
        </View>
        <View style={[styles.chevronBox, { backgroundColor: colors.gray100 }]}>
          <Ionicons name="chevron-forward" size={16} color={colors.gray400} />
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

// ── Main ───────────────────────────────────────────────────────────────────────

type Tab = 'lists' | 'notes';

export default function LijstenTab() {
  const { user } = useUser();
  const { colors, isDark } = useTheme();
  const { settings } = useModuleSettings();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [activeTab, setActiveTab] = useState<Tab>('lists');
  const [lists, setLists] = useState<(List & { item_count: number })[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [selectedNote, setSelectedNote] = useState<Note | null>(null);

  const fetchLists = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); setRefreshing(false); return; }
    const { data } = await supabase
      .from('lists').select('*, list_items(count)')
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

  const showNotesTab = settings.notes_enabled;

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      {/* Banner */}
      <View style={[styles.banner, { paddingTop: insets.top + 40 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
        <Text style={styles.bannerEyebrow}>Goedemorgen 👋</Text>
        <Text style={styles.bannerTitle}>{activeTab === 'lists' ? 'Mijn lijsten' : 'Notities'}</Text>

        {activeTab === 'lists' && (
          <View style={styles.bannerStats}>
            <View style={styles.statPill}>
              <Text style={styles.statNum}>{lists.length}</Text>
              <Text style={styles.statLabel}>{lists.length === 1 ? 'lijst' : 'lijsten'}</Text>
            </View>
            <View style={styles.statPill}>
              <Text style={styles.statNum}>{lists.reduce((s, l) => s + l.item_count, 0)}</Text>
              <Text style={styles.statLabel}>items totaal</Text>
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

      {/* Toggle (only if notes enabled) */}
      {showNotesTab && (
        <View style={[styles.tabToggleWrap, { backgroundColor: colors.offWhite }]}>
          <View style={[styles.tabToggle, { backgroundColor: colors.gray100 }]}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'lists' && styles.tabBtnActive]}
              onPress={() => setActiveTab('lists')}
            >
              <Ionicons name={activeTab === 'lists' ? 'layers' : 'layers-outline'} size={15} color={activeTab === 'lists' ? Colors.white : colors.gray400} />
              <Text style={[styles.tabBtnLabel, { color: colors.gray400 }, activeTab === 'lists' && styles.tabBtnLabelActive]}>Lijsten</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'notes' && styles.tabBtnActive]}
              onPress={() => setActiveTab('notes')}
            >
              <Ionicons name={activeTab === 'notes' ? 'document-text' : 'document-text-outline'} size={15} color={activeTab === 'notes' ? Colors.white : colors.gray400} />
              <Text style={[styles.tabBtnLabel, { color: colors.gray400 }, activeTab === 'notes' && styles.tabBtnLabelActive]}>Notities</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Lists view */}
      {activeTab === 'lists' && (
        loading ? (
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map(i => <SkeletonListCard key={i} />)}
          </View>
        ) : lists.length === 0 ? (
          <View style={[styles.emptyContainer, { backgroundColor: colors.offWhite }]}>
            <LinearGradient colors={['#FCC10C22', '#FCC10C00']} style={styles.emptyGlow} />
            <View style={[styles.emptyIcon, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="layers-outline" size={32} color={colors.gray400} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.black }]}>Nog geen lijsten</Text>
            <Text style={[styles.emptyText, { color: colors.gray400 }]}>
              Stuur een WhatsApp-bericht zoals:{'\n'}
              <Text style={styles.exampleMsg}>"citroenen kopen"</Text>
            </Text>
          </View>
        ) : (
          <FlatList
            data={lists}
            keyExtractor={(l) => l.id}
            contentContainerStyle={styles.list}
            style={{ backgroundColor: colors.offWhite }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchLists(); }} tintColor={Colors.yellow} />}
            renderItem={({ item, index }) => (
              <AnimatedCard
                item={item} index={index} colors={colors}
                onPress={() => router.push({ pathname: '/list/[id]', params: { id: item.id, name: item.name, emoji: item.emoji } })}
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

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: { paddingHorizontal: 32, paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  bannerEyebrow: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#666', marginBottom: 6 },
  bannerTitle: { fontFamily: 'Inter_700Bold', fontSize: 32, color: Colors.white, letterSpacing: -1, marginBottom: 16 },
  bannerStats: { flexDirection: 'row', gap: 10 },
  statPill: {
    flexDirection: 'row', alignItems: 'baseline', gap: 5,
    backgroundColor: '#FFFFFF10', borderRadius: Radius.pill,
    paddingHorizontal: 14, paddingVertical: 7,
    borderWidth: 1, borderColor: '#FFFFFF18',
  },
  statNum: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.white },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: '#888' },

  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchBarFocused: { borderColor: Colors.yellow + '60' },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.white },

  tabToggleWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  tabToggle: { flexDirection: 'row', borderRadius: 12, padding: 4 },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 9, borderRadius: 10,
  },
  tabBtnActive: { backgroundColor: Colors.black },
  tabBtnLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  tabBtnLabelActive: { color: Colors.white },

  skeletonList: { padding: 16 },
  list: { padding: 24, gap: 12, paddingBottom: 120 },
  card: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Radius.lg, padding: 14, ...Shadow.card,
  },
  emojiBox: { width: 52, height: 52, borderRadius: Radius.md, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  cardEmoji: { fontSize: 24 },
  cardBody: { flex: 1 },
  cardName: { fontFamily: 'Inter_700Bold', fontSize: 16, marginBottom: 3, letterSpacing: -0.2 },
  cardCount: { fontFamily: 'Inter_300Light', fontSize: 13 },
  chevronBox: { width: 28, height: 28, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },

  noteGrid: { padding: 20, paddingBottom: 120 },
  noteRow: { gap: 10, marginBottom: 10 },
  noteCard: { flex: 1, borderRadius: Radius.lg, padding: 16, minHeight: 130, ...Shadow.card },
  noteCardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, marginBottom: 8, letterSpacing: -0.2 },
  noteCardBody: { fontFamily: 'Inter_300Light', fontSize: 13, lineHeight: 19, flex: 1 },
  noteCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  noteCardDate: { fontFamily: 'Inter_300Light', fontSize: 11 },

  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyGlow: { position: 'absolute', top: -60, width: 300, height: 300, borderRadius: 150 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 8 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 15, textAlign: 'center', lineHeight: 24 },
  exampleMsg: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.gray600, fontStyle: 'italic' },

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
