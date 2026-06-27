import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, ScrollView, StyleSheet, RefreshControl,
  TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useUser } from '@/context/UserContext';
import { useTheme } from '@/context/ThemeContext';
import { Colors, Radius } from '@/constants/Design';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

type AdminUser = {
  id: string;
  phone: string | null;
  name: string | null;
  messages: number;
  active: boolean;
  onboarded: boolean;
  calendar: string | null;
  joined: string;
};

type Stats = {
  total_users: number;
  active_users: number;
  total_messages: number;
  est_monthly_eur: number;
  fixed_costs: { label: string; eur: number }[];
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
      const res = await fetch(`${API_BASE}/admin/stats?userId=${user.id}`);
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

  const bg = isDark ? '#0A0A0A' : '#F4F4F0';
  const cardBg = colors.surface;
  const labelColor = colors.gray400;

  if (loading) {
    return (
      <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['bottom']}>
        <ActivityIndicator style={{ marginTop: 60 }} color={Colors.yellow} />
      </SafeAreaView>
    );
  }

  if (error || !stats) {
    return (
      <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['bottom']}>
        <Text style={[s.errorText, { color: colors.gray400 }]}>{error || 'Geen data'}</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.yellow} />}
      >
        {/* ── Stat cards ── */}
        <View style={s.row}>
          <StatCard icon="people-outline" label="Aangemeld" value={String(stats.total_users)} bg={cardBg} labelColor={labelColor} colors={colors} />
          <StatCard icon="chatbubbles-outline" label="Actief" value={String(stats.active_users)} bg={cardBg} labelColor={labelColor} colors={colors} />
        </View>
        <View style={s.row}>
          <StatCard icon="send-outline" label="Berichten" value={String(stats.total_messages)} bg={cardBg} labelColor={labelColor} colors={colors} />
          <StatCard icon="wallet-outline" label="Est. /mnd" value={`€${stats.est_monthly_eur}`} bg={cardBg} labelColor={labelColor} colors={colors} accent={Colors.yellow} />
        </View>

        {/* ── Kosten breakdown ── */}
        <Text style={[s.sectionTitle, { color: labelColor }]}>KOSTEN BREAKDOWN</Text>
        <View style={[s.card, { backgroundColor: cardBg }]}>
          {stats.fixed_costs.map((c, i) => (
            <View key={c.label}>
              {i > 0 && <View style={[s.divider, { backgroundColor: colors.gray100 }]} />}
              <View style={s.costRow}>
                <Text style={[s.costLabel, { color: colors.black }]}>{c.label}</Text>
                <Text style={[s.costVal, { color: c.eur > 0 ? colors.black : labelColor }]}>
                  {c.eur > 0 ? `€${c.eur.toFixed(2)}` : 'Gratis'}
                </Text>
              </View>
            </View>
          ))}
          <View style={[s.divider, { backgroundColor: colors.gray100 }]} />
          <View style={s.costRow}>
            <Text style={[s.costLabel, { color: colors.black }]}>AI + WhatsApp (variabel)</Text>
            <Text style={[s.costVal, { color: colors.black }]}>
              €{(stats.est_monthly_eur - stats.fixed_costs.reduce((a, c) => a + c.eur, 0)).toFixed(2)}
            </Text>
          </View>
          <View style={[s.divider, { backgroundColor: Colors.yellow + '40' }]} />
          <View style={s.costRow}>
            <Text style={[s.costLabel, { color: colors.black, fontFamily: 'Inter_700Bold' }]}>Totaal schatting</Text>
            <Text style={[s.costVal, { color: Colors.yellow, fontFamily: 'Inter_700Bold', fontSize: 16 }]}>€{stats.est_monthly_eur}</Text>
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
                <View style={[s.badge, { backgroundColor: u.active ? '#E8F9EF' : colors.gray100 }]}>
                  <Text style={[s.badgeText, { color: u.active ? '#16A34A' : labelColor }]}>
                    {u.active ? 'Actief' : 'Nieuw'}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 40 }} />
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
  row: { flexDirection: 'row', gap: 8, marginBottom: 0 },
  sectionTitle: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 0.8,
    marginTop: 16, marginBottom: 8, paddingHorizontal: 4,
  },
  card: { borderRadius: Radius.lg, overflow: 'hidden' },
  divider: { height: 1 },
  errorText: { textAlign: 'center', marginTop: 60, fontFamily: 'Inter_400Regular' },

  // Stat cards
  statCard: {
    flex: 1, borderRadius: Radius.lg, padding: 16,
    alignItems: 'flex-start', justifyContent: 'flex-end', minHeight: 90,
  },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 28, lineHeight: 32, marginBottom: 2 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  // Cost rows
  costRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 13 },
  costLabel: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  costVal: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },

  // User rows
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
