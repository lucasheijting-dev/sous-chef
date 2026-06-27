import { ScrollView, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { Radius } from '@/constants/Design';

const MESSAGES = [
  {
    emoji: '📊',
    title: 'Weekoverzicht',
    time: 'Maandag 09:00',
    desc: 'Een samenvatting van je openstaande lijsten, afspraken deze week en actieve habits.',
    example: '📋 Weekoverzicht — Sous-Chef\n\nOpenstaande lijsten:\n🛒 Boodschappen: 4 items\n\nAfspraken:\n📅 Tandarts — do 26 jun\n\n3 actieve habits — houd ze bij! 🏆',
    color: '#6B8CFF',
  },
  {
    emoji: '🏋️',
    title: 'Habit herinnering',
    time: 'Dagelijks op jouw ingestelde tijd',
    desc: 'Herinnert je aan je actieve habits met je mini-, plus- en elite-doelen. Tijd stel je in via Instellingen → Habits.',
    example: '🏋️ Habit herinnering!\n\n• Mediteren — ⚡ 5 min / ⭐ 15 min / 🏆 30 min\n• Lezen — ⚡ 10 blz / ⭐ 20 blz / 🏆 30 blz\n\nLog je voortgang door een berichtje te sturen.',
    color: '#22C55E',
  },
  {
    emoji: '📅',
    title: 'Afspraak herinnering',
    time: 'Dag van tevoren om 08:00',
    desc: 'Bij afspraken met een herinnering (standaard 1 dag van tevoren) stuur ik een WhatsApp.',
    example: '📅 Herinnering: Tandarts\n\nDit staat gepland op donderdag 26 juni.',
    color: '#4A90D8',
  },
  {
    emoji: '🎂',
    title: 'Verjaardagsherinnering',
    time: 'Op de dag zelf om 08:30',
    desc: 'Als je een verjaardag hebt ingevoerd als terugkerende afspraak, herinnert Sous-Chef je op de dag zelf.',
    example: '🎂 Vandaag is het de verjaardag van Mama! Vergeet niet te feliciteren 🎉',
    color: '#FF6B6B',
  },
  {
    emoji: '⏰',
    title: 'Timed reminder',
    time: 'Op het exact ingeplande tijdstip',
    desc: 'Als je een specifieke herinnering instuurt ("herinner me morgen om 10 uur aan de meeting"), stuur ik die precies op tijd.',
    example: '⏰ Herinnering: Bellen met accountant',
    color: '#F59E0B',
  },
  {
    emoji: '💡',
    title: 'Wekelijkse suggesties',
    time: 'Donderdag 10:00',
    desc: 'Tips en ideeën gebaseerd op je gebruik van de week ervoor — bijv. habits die je vaak mist of lijsten die groot worden.',
    example: '💡 Tip van de week: Je Boodschappen-lijst heeft 12 items — wil je er een paar afvinken of archiveren?',
    color: '#8B5CF6',
  },
  {
    emoji: '🔄',
    title: 'Terugkerende lijstitems',
    time: 'Dagelijks 06:00 (stille verwerking)',
    desc: 'Items die je als terugkerend hebt ingesteld (bijv. elke maandag "weekboodschappen") worden automatisch toegevoegd. Je ontvangt hier geen WhatsApp voor.',
    example: '— geen bericht, item verschijnt gewoon in je lijst —',
    color: '#A9AFB7',
  },
  {
    emoji: '⚠️',
    title: 'Agenda-sync waarschuwing',
    time: 'Eénmalig bij probleem (daarna 1x per dag max)',
    desc: 'Als je iPhone/Google/Outlook agenda-koppeling stuk is, stuur ik een waarschuwing met instructies om opnieuw te verbinden.',
    example: '⚠️ Kalender-sync onderbroken.\n\nSous-Chef kan geen afspraken meer toevoegen aan je agenda. Ga naar Instellingen → Agenda in de app om opnieuw te verbinden.',
    color: '#EF4444',
  },
];

export default function AutoMessagesScreen() {
  const { colors, isDark } = useTheme();
  const bg = isDark ? '#0A0A0A' : '#F4F4F0';

  return (
    <SafeAreaView style={[s.flex, { backgroundColor: bg }]} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>
        <Text style={[s.intro, { color: colors.gray400 }]}>
          Sous-Chef stuurt automatisch berichten op vaste momenten. Hier zie je welke dat zijn en wanneer.
        </Text>

        {MESSAGES.map((msg, i) => (
          <View key={i} style={[s.card, { backgroundColor: colors.surface }]}>
            <View style={s.cardHeader}>
              <View style={[s.iconBox, { backgroundColor: msg.color + '20' }]}>
                <Text style={s.iconText}>{msg.emoji}</Text>
              </View>
              <View style={s.cardTitles}>
                <Text style={[s.title, { color: colors.black }]}>{msg.title}</Text>
                <View style={s.timeRow}>
                  <Ionicons name="time-outline" size={12} color={colors.gray400} />
                  <Text style={[s.time, { color: colors.gray400 }]}>{msg.time}</Text>
                </View>
              </View>
            </View>

            <Text style={[s.desc, { color: colors.gray400 }]}>{msg.desc}</Text>

            <View style={[s.exampleBox, { backgroundColor: isDark ? '#1A1A1A' : '#F0F0EC', borderColor: isDark ? '#2A2A2A' : '#E4E4E0' }]}>
              <Text style={[s.exampleLabel, { color: colors.gray400 }]}>Voorbeeld bericht</Text>
              <Text style={[s.exampleText, { color: colors.black }]}>{msg.example}</Text>
            </View>
          </View>
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: 16, gap: 12 },
  intro: { fontFamily: 'Inter_300Light', fontSize: 14, lineHeight: 20, marginBottom: 4 },
  card: { borderRadius: Radius.lg, padding: 16, gap: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBox: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  iconText: { fontSize: 22 },
  cardTitles: { flex: 1 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  time: { fontFamily: 'Inter_300Light', fontSize: 12 },
  desc: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 19 },
  exampleBox: { borderRadius: Radius.md, padding: 12, borderWidth: 1, gap: 4 },
  exampleLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.6 },
  exampleText: { fontFamily: 'Inter_300Light', fontSize: 13, lineHeight: 18 },
});
