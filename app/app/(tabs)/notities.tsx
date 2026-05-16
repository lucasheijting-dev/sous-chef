import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  SafeAreaView,
  Animated,
  Pressable,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { Note } from '@/lib/types';
import { Colors, Radius, Shadow } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';

function getCardStyles(isDark: boolean) {
  return [
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: Colors.black, title: Colors.yellow, body: '#888', date: '#444' },
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: isDark ? '#242426' : '#F5F5F0', title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
  ];
}

function NoteCard({ item, index, onPress }: { item: Note; index: number; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const { isDark } = useTheme();
  const CARD_STYLES = getCardStyles(isDark);
  const style = CARD_STYLES[index % CARD_STYLES.length];

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, delay: (index % 4) * 50, useNativeDriver: true }),
      Animated.spring(slideAnim, { toValue: 0, delay: (index % 4) * 50, tension: 80, friction: 12, useNativeDriver: true }),
    ]).start();
  }, []);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'short' });
  }

  return (
    <Animated.View style={{ flex: 1, opacity: fadeAnim, transform: [{ translateY: slideAnim }, { scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, speed: 50 }).start()}
        onPressOut={() => Animated.spring(scale, { toValue: 1, useNativeDriver: true, speed: 50 }).start()}
        style={[styles.card, { backgroundColor: style.bg }]}
      >
        <Text style={[styles.cardTitle, { color: style.title }]} numberOfLines={2}>
          {item.title || item.body.slice(0, 40)}
        </Text>
        <Text style={[styles.cardBody, { color: style.body }]} numberOfLines={5}>
          {item.body}
        </Text>
        <View style={styles.cardFooter}>
          <Text style={[styles.cardDate, { color: style.date }]}>{formatDate(item.created_at)}</Text>
          <Ionicons name="open-outline" size={12} color={style.date} />
        </View>
      </Pressable>
    </Animated.View>
  );
}

export default function NotitiesTab() {
  const { user } = useUser();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Note | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); setRefreshing(false); return; }
    const { data } = await supabase.from('notes').select('*').eq('user_id', user.id).order('created_at', { ascending: false });
    if (data) setNotes(data);
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    fetchNotes();
    if (!user || user.id === 'dev') return;
    const channel = supabase.channel('notes-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, fetchNotes)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchNotes]);

  const filtered = notes.filter(n =>
    n.title?.toLowerCase().includes(search.toLowerCase()) ||
    n.body.toLowerCase().includes(search.toLowerCase()),
  );

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      <View style={[styles.banner, { paddingTop: insets.top + 40 }]}>
        <BlurView intensity={Platform.OS === 'web' ? 60 : 80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.72)' }]} pointerEvents="none" />
        <View style={styles.bannerTop}>
          <View>
            <Text style={styles.bannerEyebrow}>{notes.length} opgeslagen</Text>
            <Text style={styles.bannerTitle}>Notities</Text>
          </View>
        </View>
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
      </View>

      {loading ? (
        <View style={[styles.skeletonGrid, { backgroundColor: colors.offWhite }]}>
          {[0, 1, 2, 3].map(i => (
            <View key={i} style={[styles.skeletonCard, { backgroundColor: colors.white }]}>
              <View style={[styles.skeletonLine, { backgroundColor: colors.gray100 }]} />
              <View style={[styles.skeletonLine, { backgroundColor: colors.gray100, width: '80%', marginTop: 8 }]} />
              <View style={[styles.skeletonLine, { backgroundColor: colors.gray100, width: '60%', marginTop: 6 }]} />
            </View>
          ))}
        </View>
      ) : filtered.length === 0 ? (
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
          data={filtered}
          keyExtractor={(n) => n.id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          style={{ backgroundColor: colors.offWhite }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotes(); }} tintColor={Colors.yellow} />}
          renderItem={({ item, index }) => (
            <NoteCard item={item} index={index} onPress={() => setSelected(item)} />
          )}
        />
      )}

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
            <TouchableOpacity onPress={() => setSelected(null)} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
              <Ionicons name="close" size={18} color={colors.black} />
            </TouchableOpacity>
            <Text style={[styles.modalDateHeader, { color: colors.gray400 }]}>{selected ? formatDate(selected.created_at) : ''}</Text>
            <View style={{ width: 34 }} />
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
            {selected?.title && <Text style={[styles.modalTitle, { color: colors.black }]}>{selected.title}</Text>}
            <Text style={[styles.modalBody, { color: colors.gray800 }]}>{selected?.body}</Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.offWhite },
  banner: { paddingHorizontal: 32, paddingTop: 24, paddingBottom: 28, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden' },
  bannerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14 },
  bannerEyebrow: { fontFamily: 'Inter_300Light', fontSize: 13, color: '#666', marginBottom: 4 },
  bannerTitle: { fontFamily: 'Inter_700Bold', fontSize: 32, color: Colors.white, letterSpacing: -1 },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#161616', borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 11,
    borderWidth: 1, borderColor: '#2A2A2A',
  },
  searchBarFocused: { borderColor: Colors.yellow + '60' },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.white },
  skeletonGrid: { flexDirection: 'row', flexWrap: 'wrap', padding: 12, gap: 10 },
  skeletonCard: {
    width: '47%', minHeight: 120, backgroundColor: Colors.white,
    borderRadius: Radius.lg, padding: 16, ...Shadow.card,
  },
  skeletonLine: { height: 12, backgroundColor: Colors.gray100, borderRadius: 6, width: '70%' },
  grid: { padding: 20, paddingBottom: 120 },
  row: { gap: 10, marginBottom: 10 },
  card: { flex: 1, borderRadius: Radius.lg, padding: 16, minHeight: 130, ...Shadow.card },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, marginBottom: 8, letterSpacing: -0.2 },
  cardBody: { fontFamily: 'Inter_300Light', fontSize: 13, lineHeight: 19, flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  cardDate: { fontFamily: 'Inter_300Light', fontSize: 11 },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.gray100, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, color: Colors.black, marginBottom: 12 },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400, textAlign: 'center', lineHeight: 22 },
  exampleMsg: { fontFamily: 'Inter_400Regular', fontSize: 13, color: Colors.gray600, fontStyle: 'italic' },
  modal: { flex: 1, backgroundColor: Colors.white },
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: Colors.gray100,
  },
  closeBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.gray100, justifyContent: 'center', alignItems: 'center' },
  modalDateHeader: { fontFamily: 'Inter_300Light', fontSize: 13, color: Colors.gray400 },
  modalScroll: { flex: 1 },
  modalContent: { padding: 28, paddingBottom: 60 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, color: Colors.black, marginBottom: 16, letterSpacing: -0.8 },
  modalBody: { fontFamily: 'Inter_400Regular', fontSize: 17, color: Colors.gray800, lineHeight: 30 },
});
