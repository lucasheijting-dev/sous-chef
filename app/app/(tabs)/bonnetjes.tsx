import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  ActivityIndicator, RefreshControl, Alert, Linking, Image,
  Modal, SafeAreaView, Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
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

function formatDate(iso: string | null) {
  if (!iso) return '';
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('nl-NL', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch { return iso; }
}

export default function BonnetjesTab() {
  const { user }   = useUser();
  const { colors } = useTheme();
  const insets     = useSafeAreaInsets();

  const [receipts, setReceipts]     = useState<Receipt[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [fullscreenImage, setFullscreenImage] = useState<string | null>(null);

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

  function confirmDelete(receipt: Receipt) {
    Alert.alert('Bonnetje verwijderen?', receipt.store ?? 'Dit bonnetje', [
      { text: 'Annuleer', style: 'cancel' },
      { text: 'Verwijder', style: 'destructive', onPress: async () => {
        await fetch(`${API_BASE}/receipts/${user?.id}/${receipt.id}`, { method: 'DELETE' });
        setReceipts(prev => prev.filter(r => r.id !== receipt.id));
      }},
    ]);
  }

  function openPDF() {
    Linking.openURL(`${API_BASE}/receipts/${user?.id}/export.pdf`);
  }

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
            <Text style={styles.statLabel}>totaal</Text>
          </View>
        </View>
      </View>

      <FlatList
        data={receipts}
        keyExtractor={r => r.id}
        contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.yellow} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🧾</Text>
            <Text style={[styles.emptyTitle, { color: colors.black }]}>Geen bonnetjes</Text>
            <Text style={[styles.emptyText, { color: colors.gray400 }]}>
              Stuur een foto van een kassabon via WhatsApp, dan scan ik hem automatisch.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.card, { backgroundColor: colors.white }, Shadow.card]}
            activeOpacity={0.85}
            onLongPress={() => confirmDelete(item)}
          >
            {item.image_url && (
              <Pressable onPress={() => setFullscreenImage(item.image_url)}>
                <Image source={{ uri: item.image_url }} style={styles.thumb} resizeMode="cover" />
              </Pressable>
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
                  <Text style={[styles.total, { color: colors.black }]}>€{Number(item.total).toFixed(2)}</Text>
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
            <Image source={{ uri: fullscreenImage }} style={styles.imgFull} resizeMode="contain" />
          )}
          <TouchableOpacity style={styles.imgClose} onPress={() => setFullscreenImage(null)}>
            <Ionicons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center:    { flex: 1, justifyContent: 'center', alignItems: 'center' },

  banner:      { paddingHorizontal: 24, paddingBottom: 24, borderBottomLeftRadius: 28, borderBottomRightRadius: 28, overflow: 'hidden', marginBottom: 12 },
  bannerRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  bannerTitle: { fontFamily: 'TitanOne_400Regular', fontSize: 32, color: Colors.white, letterSpacing: 1, textTransform: 'uppercase' },
  bannerStats: { flexDirection: 'row', gap: 10 },
  statTile:       { paddingHorizontal: 18, paddingVertical: 12, backgroundColor: '#FFFFFF12', borderRadius: Radius.md, borderWidth: 1, borderColor: '#FFFFFF18', minWidth: 90 },
  statTileAccent: { backgroundColor: Colors.yellow, borderColor: 'transparent' },
  statNum:   { fontFamily: 'Inter_700Bold', fontSize: 22, color: Colors.white, letterSpacing: -0.5 },
  statLabel: { fontFamily: 'Inter_300Light', fontSize: 12, color: 'rgba(255,255,255,0.55)', marginTop: 1 },
  pdfBtn:     { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#FFFFFF12', borderRadius: Radius.pill, borderWidth: 1, borderColor: '#FFFFFF20' },
  pdfBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, color: Colors.yellow },

  card:     { borderRadius: Radius.lg, overflow: 'hidden' },
  thumb:    { width: '100%', height: 140 },
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

  imgModal:  { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' },
  imgFull:   { width: '100%', height: '85%' },
  imgClose:  {
    position: 'absolute', top: 56, right: 20,
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center', alignItems: 'center',
  },
});
