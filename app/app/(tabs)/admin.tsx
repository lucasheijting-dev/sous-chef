import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl, ActivityIndicator, TouchableOpacity, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { Colors, Radius } from '@/constants/Design';

import { apiFetch } from '@/lib/api';

type CostItem = { label: string; eur: number; variable?: boolean };

type AdminUser = {
  id: string;
  phone: string | null;
  name: string | null;
  messages: number;
  active: boolean;
  onboarded: boolean;
  calendar: string | null;
  joined: string;
  is_blocked: boolean;
};

type Stats = {
  total_users: number;
  active_users: number;
  total_messages: number;
  est_monthly_eur: number;
  cost_items: CostItem[];
  users: AdminUser[];
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'vandaag';
  if (days === 1) return 'gisteren';
  if (days < 7) return `${days}d geleden`;
  if (days < 30) return `${Math.floor(days / 7)}w geleden`;
  return `${Math.floor(days / 30)}m geleden`;
}

function calIcon(cal: string | null) {
  if (cal === 'iphone') return '📅';
  if (cal === 'google') return '🔵';
  if (cal === 'outlook') return '🟦';
  return '—';
}

export default function AdminScreen() {
  const { user } = useUser();
  const { colors, isDark } = useTheme();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/admin/stats?userId=${user.id}`);
      if (!res.ok) throw new Error('unauthorized');
      setStats(await res.json());
    } catch {
      setError('Laden mislukt');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(true); };

  async function toggleBlock(u: AdminUser) {
    const action = u.is_blocked ? 'Deblokkeren' : 'Blokkeren';
    Alert.alert(
      `${action}?`,
      u.is_blocked
        ? `${u.name ?? u.phone} kan weer berichten sturen.`
        : `${u.name ?? u.phone} kan geen berichten meer sturen.`,
      [
        { text: 'Annuleer', style: 'cancel' },
        {
          text: action,
          style: u.is_blocked ? 'default' : 'destructive',
          onPress: async () => {
            const newBlocked = !u.is_blocked;
            setStats(prev => prev ? {
              ...prev,
              users: prev.users.map(x => x.id === u.id ? { ...x, is_blocked: newBlocked } : x),
            } : prev);
            await apiFetch(`/admin/users/${u.id}/block?userId=${user!.id}`, {
              method: 'PATCH',
              body: JSON.stringify({ blocked: newBlocked }),
            }).catch(() => load(true));
          },
        },
      ],
    );
  }

  const bg = isDark ? '#0A0A0A' : '#F4F4F0';
  const cardBg = colors.surface;
  const labelColor = colors.gray400;

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['top', 'bottom']}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.yellow} />
      </SafeAreaView>
    );
  }

  if (error || !stats) {
    return (
      <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['top', 'bottom']}>
        <Text style={[s.errorText, { color: colors.gray400 }]}>{error || 'Geen data'}</Text>
      </SafeAreaView>
    );
  }

  const totalCost = stats.cost_items.reduce((a, c) => a + c.eur, 0);

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.yellow} />}
      >
        <Text style={[s.pageTitle, { color: colors.black }]}>Admin 🛡️</Text>

        {/* ── Stat cards ── */}
        <View style={s.row}>
          <StatCard icon="people-outline" label="Aangemeld" value={String(stats.total_users)} bg={cardBg} labelColor={labelColor} colors={colors} />
          <StatCard icon="flash-outline" label="Actief" value={String(stats.active_users)} bg={cardBg} labelColor={labelColor} colors={colors} />
        </View>
        <View style={s.row}>
          <StatCard icon="chatbubbles-outline" label="Berichten" value={String(stats.total_messages)} bg={cardBg} labelColor={labelColor} colors={colors} />
          <StatCard icon="wallet-outline" label="Est. /mnd" value={`€${stats.est_monthly_eur}`} bg={cardBg} labelColor={labelColor} colors={colors} accent={Colors.yellow} />
        </View>

        {/* ── Kosten breakdown ── */}
        <Text style={[s.sectionTitle, { color: labelColor }]}>KOSTEN BREAKDOWN</Text>
        <View style={[s.card, { backgroundColor: cardBg }]}>
          {stats.cost_items.map((c, i) => (
            <View key={c.label}>
              {i > 0 && <View style={[s.divider, { backgroundColor: colors.gray100 }]} />}
              <View style={s.costRow}>
                <Text style={[s.costLabel, { color: colors.black }]} numberOfLines={2}>{c.label}</Text>
                <Text style={[s.costVal, { color: c.variable ? Colors.yellow : c.eur > 0 ? colors.black : labelColor }]}>
                  {c.eur > 0 ? `€${c.eur.toFixed(2)}` : 'Gratis'}
                </Text>
              </View>
            </View>
          ))}
          <View style={[s.divider, { backgroundColor: Colors.yellow + '40' }]} />
          <View style={s.costRow}>
            <Text style={[s.costLabel, { color: colors.black, fontFamily: 'Inter_700Bold' }]}>Totaal schatting /mnd</Text>
            <Text style={[s.costVal, { color: Colors.yellow, fontFamily: 'Inter_700Bold', fontSize: 16 }]}>€{totalCost.toFixed(2)}</Text>
          </View>
        </View>

        {/* ── Gebruikers ── */}
        <Text style={[s.sectionTitle, { color: labelColor }]}>GEBRUIKERS ({stats.total_users})</Text>
        <View style={[s.card, { backgroundColor: cardBg }]}>
          {stats.users.map((u, i) => (
            <View key={u.id}>
              {i > 0 && <View style={[s.divider, { backgroundColor: colors.gray100 }]} />}
              <View style={s.userRow}>
                <View style={[s.userAvatar, { backgroundColor: u.active ? Colors.yellow + '30' : colors.gray100 }]}>
                  <Text style={s.userAvatarText}>{u.active ? '🍳' : '👤'}</Text>
                </View>
                <View style={s.userInfo}>
                  <Text style={[s.userName, { color: colors.black }]} numberOfLines={1}>
                    {u.name ?? u.phone ?? 'Onbekend'}
                  </Text>
                  {u.name && (
                    <Text style={[s.userPhone, { color: labelColor }]} numberOfLines={1}>{u.phone}</Text>
                  )}
                  <View style={s.userMeta}>
                    <Text style={[s.userMetaText, { color: labelColor }]}>{timeAgo(u.joined)}</Text>
                    <Text style={[s.userMetaDot, { color: labelColor }]}> · </Text>
                    <Text style={[s.userMetaText, { color: labelColor }]}>{u.messages} berichten</Text>
                    <Text style={[s.userMetaDot, { color: labelColor }]}> · </Text>
                    <Text style={s.userMetaText}>{calIcon(u.calendar)}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <View style={[s.badge, { backgroundColor: u.active ? '#E8F9EF' : colors.gray100 }]}>
                    <Text style={[s.badgeText, { color: u.active ? '#16A34A' : labelColor }]}>
                      {u.active ? 'Actief' : 'Nieuw'}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => toggleBlock(u)}
                    style={[s.badge, { backgroundColor: u.is_blocked ? '#FEE2E2' : colors.gray100 }]}
                    activeOpacity={0.7}
                  >
                    <Text style={[s.badgeText, { color: u.is_blocked ? '#EF4444' : labelColor }]}>
                      {u.is_blocked ? '🚫 Geblokkeerd' : 'Blokkeer'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function StatCard({ icon, label, value, bg, labelColor, colors, accent }: {
  icon: any; label: string; value: string;
  bg: string; labelColor: string; colors: any; accent?: string;
}) {
  return (
    <View style={[s.statCard, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={20} color={accent ?? labelColor} style={{ marginBottom: 6 }} />
      <Text style={[s.statValue, { color: accent ?? colors.black }]}>{value}</Text>
      <Text style={[s.statLabel, { color: labelColor }]}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 8 },
  pageTitle: { fontFamily: 'Inter_700Bold', fontSize: 28, marginBottom: 8, marginTop: 4 },
  row: { flexDirection: 'row', gap: 8, marginBottom: 0 },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.8,
    marginTop: 16, marginBottom: 8, paddingHorizontal: 4,
  },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: 1 },
  errorText: { textAlign: 'center', marginTop: 60, fontFamily: 'Inter_400Regular' },

  statCard: {
    flex: 1, borderRadius: Radius.lg, padding: 16,
    alignItems: 'flex-start', justifyContent: 'flex-end', minHeight: 90,
  },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 32, marginBottom: 2 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  costRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  costLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  costVal: { fontFamily: 'Inter_600SemiBold', fontSize: 14, flexShrink: 0 },

  userRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, gap: 12 },
  userAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  userAvatarText: { fontSize: 18 },
  userInfo: { flex: 1, minWidth: 0 },
  userName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  userPhone: { fontFamily: 'Inter_300Light', fontSize: 12, marginTop: 1 },
  userMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 3, flexWrap: 'wrap' },
  userMetaText: { fontFamily: 'Inter_300Light', fontSize: 11 },
  userMetaDot: { fontFamily: 'Inter_300Light', fontSize: 11 },
  badge: { borderRadius: Radius.pill, paddingHorizontal: 8, paddingVertical: 4, flexShrink: 0 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
});
