import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  View, Text, SectionList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Linking, Image,
  Modal, SafeAreaView, Pressable, TextInput, ScrollView,
  Share, PanResponder, Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { Colors, Radius, Shadow } from '@/constants/Design';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

type Receipt = {
  id: string;
  store: string | null;
  date: string | null;
  total: number | null;
  currency: string;
  items: { name: string; price: number | null; quantity: number }[];
  category: string | null;
  description: string | null;
  image_url: string | null;
  created_at: string;
};

const CATEGORY_EMOJI: Record<string, string> = {
  supermarkt: '🛒', restaurant: '🍽️', kleding: '👕',
  benzine: '⛽', apotheek: '💊', overig: '🧾',
};

const FILTER_CHIPS: { label: string; value: string | null }[] = [
  { label: 'Alle', value: null },
  { label: '🛒 Supermarkt', value: 'supermarkt' },
  { label: '🍽️ Restaurant', value: 'restaurant' },
  { label: '👕 Kleding', value: 'kleding' },
  { label: '⛽ Benzine', value: 'benzine' },
  { label: '💊 Apotheek', value: 'apotheek' },
  { label: '🧾 Overig', value: 'overig' },
];

function formatDate(iso: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

function formatMonthTitle(key: string) {
  if (key === 'onbekend') return 'Onbekend';
  try {
    const [year, month] = key.split('-');
    const d = new Date(Number(year), Number(month) - 1, 1);
    const name = d.toLocaleDateString('nl-NL', { month: 'long', year: 'numeric' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  } catch { return key; }
}

function formatCurrency(amount: number, currency: string) {
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${symbol}${amount.toFixed(2).replace('.', ',')}`;
}

export default function BonnetjesTab() {
  const { user }   = useUser();
  const { colors } = useTheme();
  const insets     = useSafeAreaInsets();

  const [receipts, setReceipts]     = useState<Receipt[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);
  const [query, setQuery]           = useState('');
  const [filterCat, setFilterCat]   = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Pinch-to-zoom state
  const scale      = useRef(new Animated.Value(1)).current;
  const lastScale  = useRef(1);
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (_, gs) => gs.numberActiveTouches === 2,
      onMoveShouldSetPanResponder:  (_, gs) => gs.numberActiveTouches === 2,
      onPanResponderGrant: () => { lastScale.current = 1; },
      onPanResponderMove: (e) => {
        const touches = e.nativeEvent.touches;
        if (touches.length < 2) return;
        const dx = touches[0].pageX - touches[1].pageX;
        const dy = touches[0].pageY - touches[1].pageY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (!(panResponder as any)._initialDist) {
          (panResponder as any)._initialDist = dist;
          return;
        }
        const newScale = Math.min(4, Math.max(1, (dist / (panResponder as any)._initialDist) * lastScale.current));
        scale.setValue(newScale);
      },
      onPanResponderRelease: () => {
        lastScale.current = (scale as any)._value ?? 1;
        (panResponder as any)._initialDist = null;
        if (lastScale.current <= 1) {
          Animated.spring(scale, { toValue: 1, useNativeDriver: true }).start();
          lastScale.current = 1;
        }
      },
    })
  ).current;

  const load = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); return; }
    try {
      const res = await fetch(`${API_BASE}/receipts/${user.id}`);
      const data = await res.json();
      setReceipts(Array.isArray(data) ? data : []);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const totalSpent = receipts.reduce((s, r) => s + (r.total ?? 0), 0);
  const thisMonth  = receipts.filter(r => r.date?.startsWith(new Date().toISOString().slice(0, 7)));
  const monthTotal = thisMonth.reduce((s, r) => s + (r.total ?? 0), 0);

  async function deleteReceipt(receiptId: string) {
    setReceipts(prev => prev.filter(r => r.id !== receiptId));
    setDeletingId(null);
    await fetch(`${API_BASE}/receipts/${user?.id}/${receiptId}`, { method: 'DELETE' });
  }

  function openPDF() {
    Linking.openURL(`${API_BASE}/receipts/${user?.id}/export.pdf`);
  }

  const filteredReceipts = useMemo(() => {
    let list = receipts;
    if (filterCat) list = list.filter(r => r.category === filterCat);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(r =>
        (r.store ?? '').toLowerCase().includes(q) ||
        (r.description ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [receipts, filterCat, query]);

  const sections = useMemo(() => {
    const map = new Map<string, Receipt[]>();
    for (const r of filteredReceipts) {
      const key = r.date ? r.date.slice(0, 7) : 'onbekend';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([key, data]) => ({
        title: key,
        data,
        total: data.reduce((s, r) => s + (r.total ?? 0), 0),
      }));
  }, [filteredReceipts]);

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: colors.offWhite }]}>
        <ActivityIndicator size="large" color={Colors.yellow} />
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
      {/* Banner */}
      <View style={[styles.banner, { paddingTop: insets.top + 36 }]}>
        <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,10,10,0.75)' }]} pointerEvents="none" />
        <View style={styles.bannerRow}>
          <Text style={styles.bannerTitle}>Bonnetjes</Text>
          <TouchableOpacity style={styles.pdfBtn} onPress={openPDF}>
            <Ionicons name="download-outline" size={14} color={Colors.yellow} />
            <Text style={styles.pdfBtnText}>PDF</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.bannerStats}>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>{receipts.length}</Text>
            <Text style={styles.statLabel}>totaal</Text>
          </View>
          <View style={[styles.statTile, styles.statTileAccent]}>
            <Text style={[styles.statNum, { color: Colors.black }]}>€{monthTotal.toFixed(0)}</Text>
            <Text style={[styles.statLabel, { color: 'rgba(0,0,0,0.55)' }]}>deze maand</Text>
          </View>
          <View style={styles.statTile}>
            <Text style={styles.statNum}>€{totalSpent.toFixed(0)}</Text>
            <Text style={styles.statLabel}>ooit</Text>
          </View>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={16} color={colors.gray400} style={styles.searchIcon} />
        <TextInput
          style={[styles.searchInput, { color: colors.black }]}
          placeholder="Zoek op winkel of omschrijving…"
          placeholderTextColor={colors.gray400}
          value={query}
          onChangeText={setQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
      </View>

      {/* Category filter chips */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipsRow}
      >
        {FILTER_CHIPS.map(chip => {
          const active = filterCat === chip.value;
          return (
            <TouchableOpacity
              key={chip.label}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                Haptics.selectionAsync();
                setFilterCat(chip.value);
              }}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <SectionList
        sections={sections}
        keyExtractor={r => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        stickySectionHeadersEnabled
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.yellow} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🧾</Text>
            <Text style={[styles.emptyTitle, { color: colors.black }]}>
              {query || filterCat ? 'Geen resultaten' : 'Geen bonnetjes'}
            </Text>
            <Text style={[styles.emptyText, { color: colors.gray400 }]}>
              {query || filterCat
                ? 'Probeer een andere zoekterm of filter.'
                : 'Stuur een foto van een kassabon via WhatsApp, dan scan ik hem automatisch.'}
            </Text>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{formatMonthTitle(section.title)}</Text>
            <Text style={styles.sectionTotal}>€{section.total.toFixed(2).replace('.', ',')}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <Pressable onPress={() => deletingId && setDeletingId(null)} style={{ position: 'relative' }}>
          <TouchableOpacity
            style={[styles.card, { backgroundColor: colors.white }, Shadow.card]}
            activeOpacity={0.85}
            onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setDeletingId(item.id); }}
          >
            {item.image_url && (
              <View>
                <Image source={{ uri: item.image_url }} style={styles.thumb} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.thumbBtn}
                  onPress={() => {
                    scale.setValue(1);
                    lastScale.current = 1;
                    setFullscreenImage(item.image_url);
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="expand-outline" size={15} color="#fff" />
                </TouchableOpacity>
              </View>
            )}
            <View style={styles.cardBody}>
              <View style={styles.cardTop}>
                <Text style={styles.emoji}>{CATEGORY_EMOJI[item.category ?? ''] ?? '🧾'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.store, { color: colors.black }]} numberOfLines={1}>
                    {item.store ?? 'Onbekende winkel'}
                  </Text>
                  {item.date && <Text style={[styles.date, { color: colors.gray400 }]}>{formatDate(item.date)}</Text>}
                </View>
                {item.total != null && (
                  <Text style={[styles.total, { color: colors.black }]}>
                    {formatCurrency(item.total, item.currency ?? 'EUR')}
                  </Text>
                )}
              </View>
              {item.description && (
                <Text style={[styles.desc, { color: colors.gray400 }]} numberOfLines={2}>{item.description}</Text>
              )}
              {Array.isArray(item.items) && item.items.length > 0 && (
                <Text style={[styles.itemCount, { color: colors.gray400 }]}>
                  {item.items.length} {item.items.length === 1 ? 'artikel' : 'artikelen'}
                </Text>
              )}
            </View>
          </TouchableOpacity>
          {deletingId === item.id && (
            <TouchableOpacity
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#EF4444', borderRadius: Radius.lg, justifyContent: 'center', alignItems: 'center', flexDirection: 'row', gap: 8 }}
              onPress={() => deleteReceipt(item.id)}
              activeOpacity={0.85}
            >
              <Ionicons name="trash-outline" size={18} color="#fff" />
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>Verwijder</Text>
            </TouchableOpacity>
          )}
          </Pressable>
        )}
      />

      {/* Fullscreen receipt image */}
      <Modal
        visible={!!fullscreenImage}
        animationType="fade"
        transparent
        onRequestClose={() => setFullscreenImage(null)}
      >
        <SafeAreaView style={styles.imgModal}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setFullscreenImage(null)} />
          {fullscreenImage && (
            <Animated.View
              style={{ width: '100%', height: '85%', transform: [{ scale }] }}
              {...panResponder.panHandlers}
            >
              <Image source={{ uri: fullscreenImage }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            </Animated.View>
          )}
          <View style={styles.imgTopBar}>
            <TouchableOpacity
              style={styles.imgIconBtn}
              onPress={() => fullscreenImage && Share.share({ url: fullscreenImage })}
            >
              <Ionicons name="share-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={styles.imgIconBtn} onPress={() => setFullscreenImage(null)}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  banner:      { paddingHorizontal: 24, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden', marginBottom: 4 },
  bannerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 32, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase' },
  bannerStats: { flexDirection: 'row', gap: 10 },
  statTile:       { paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#FFFFFF12', borderRadius: Radius.md, borderWidth: 1, borderColor: '#FFFFFF18', minWidth: 90 },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum:   { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  pdfBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFFFFF12', borderRadius: Radius.pill, borderWidth: 1, borderColor: '#FFFFFF20' },
  pdfBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.yellow },

  searchRow:   { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 12, marginBottom: 4, backgroundColor: '#F0F0F0', borderRadius: Radius.pill, paddingHorizontal: 14, paddingVertical: 10 },
  searchIcon:  { marginRight: 8 },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, padding: 0 },

  chipsRow:   { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  chip:       { paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#EBEBEB', borderRadius: Radius.pill },
  chipActive: { backgroundColor: Colors.yellow },
  chipText:   { fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#555' },
  chipTextActive: { color: Colors.black },

  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 8,
    backgroundColor: 'rgba(20,20,20,0.82)', borderRadius: Radius.lg,
  },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.white },
  sectionTotal: { fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.yellow },

  card:     { borderRadius: Radius.lg, overflow: 'hidden' },
  thumb:    { width: '100%', height: 140 },
  thumbBtn: { position: 'absolute', bottom: 8, right: 8, backgroundColor: 'rgba(0,0,0,0.55)', borderRadius: 8, padding: 6 },
  cardBody: { padding: 14, gap: 6 },
  cardTop:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emoji:    { fontSize: 22 },
  store:    { fontFamily: 'Inter_700Bold', fontSize: 15 },
  date:     { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  total:    { fontFamily: 'Inter_700Bold', fontSize: 18 },
  desc:     { fontFamily: 'Inter_400Regular', fontSize: 12 },
  itemCount:{ fontFamily: 'Inter_300Light', fontSize: 11 },

  empty:      { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32 },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, marginBottom: 8 },
  emptyText:  { fontFamily: 'Inter_300Light', fontSize: 14, textAlign: 'center', lineHeight: 20 },

  imgModal:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  imgTopBar:  { position: 'absolute', top: 56, right: 20, flexDirection: 'row', gap: 10 },
  imgIconBtn: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
});
