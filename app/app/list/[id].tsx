import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Keyboard,
  Animated,
  Platform,
  Switch,
  Alert,
  Modal,
} from 'react-native';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { ListItem } from '@/lib/types';
import { Colors, Radius, Shadow } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';
import { Toast, useToast } from '@/components/Toast';
import { useUser } from '@/context/UserContext';
import {
  isBoodschappenlijst,
  isGeoAlertEnabled,
  startGeoAlertTask,
  stopGeoAlertTask,
} from '@/lib/geoAlert';
import { SkeletonListCard } from '@/components/SkeletonCard';

function haptic(style: 'light' | 'medium' | 'warning' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function AnimatedCheckbox({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;

  function handlePress() {
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.8, duration: 80, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 8 }),
    ]).start();
    onPress();
  }

  return (
    <TouchableOpacity onPress={handlePress} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={1}>
      <Animated.View style={[styles.checkbox, checked && styles.checkboxDone, { transform: [{ scale }] }]}>
        {checked && <Ionicons name="checkmark" size={13} color={Colors.black} />}
      </Animated.View>
    </TouchableOpacity>
  );
}

function SwipeableItem({
  item,
  onToggle,
  onDelete,
}: {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { colors } = useTheme();
  const swipeRef = useRef<Swipeable>(null);

  function handleDelete() {
    swipeRef.current?.close();
    haptic('warning');
    onDelete();
  }

  const renderRightActions = (_prog: Animated.AnimatedInterpolation<number>, drag: Animated.AnimatedInterpolation<number>) => {
    const scale = drag.interpolate({ inputRange: [-80, 0], outputRange: [1, 0.7], extrapolate: 'clamp' });
    return (
      <TouchableOpacity style={styles.deleteAction} onPress={handleDelete} activeOpacity={0.8}>
        <Animated.View style={{ transform: [{ scale }] }}>
          <Ionicons name="trash-outline" size={20} color={Colors.white} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={renderRightActions}
      rightThreshold={40}
      overshootRight={false}
    >
      <TouchableOpacity
        style={[styles.item, { backgroundColor: colors.white }, item.checked && { backgroundColor: colors.gray100 }]}
        onPress={() => { haptic('light'); onToggle(); }}
        activeOpacity={0.8}
      >
        <AnimatedCheckbox checked={item.checked} onPress={onToggle} />
        <Text style={[styles.itemText, { color: colors.black }, item.checked && { color: colors.gray400, textDecorationLine: 'line-through' }]}>{item.text}</Text>
        {!item.checked && (
          <Ionicons name="reorder-three" size={18} color={colors.gray200} />
        )}
      </TouchableOpacity>
    </Swipeable>
  );
}

export default function ListDetailScreen() {
  const { id, name, emoji } = useLocalSearchParams<{ id: string; name: string; emoji: string }>();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user } = useUser();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [adding, setAdding] = useState(false);
  const { toastProps, show: showToast } = useToast();

  const isGroceryList = isBoodschappenlijst(name ?? '');
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoToggling, setGeoToggling] = useState(false);
  const [geoPermModal, setGeoPermModal] = useState(false);

  useEffect(() => {
    if (!isGroceryList) return;
    isGeoAlertEnabled().then(setGeoEnabled);
  }, [isGroceryList]);

  useEffect(() => {
    navigation.setOptions({ title: `${emoji || '📝'} ${name}` });
  }, [name, emoji]);

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('list_items').select('*').eq('list_id', id).order('created_at', { ascending: true });
    if (data) setItems(data);
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useEffect(() => {
    fetchItems();
    const channel = supabase.channel(`list-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items', filter: `list_id=eq.${id}` }, fetchItems)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, fetchItems]);

  async function toggleItem(item: ListItem) {
    haptic('light');
    await supabase.from('list_items').update({ checked: !item.checked }).eq('id', item.id);
    if (!item.checked) showToast('Afgevinkt ✓', 'success');
    fetchItems();
  }

  async function deleteItem(itemId: string) {
    await supabase.from('list_items').delete().eq('id', itemId);
    showToast('Item verwijderd', 'info');
    fetchItems();
  }

  async function addItem() {
    if (!newItemText.trim()) return;
    setAdding(true);
    haptic('medium');
    await supabase.from('list_items').insert({ list_id: id, text: newItemText.trim(), checked: false });
    setNewItemText('');
    setAdding(false);
    Keyboard.dismiss();
    showToast(`"${newItemText.trim()}" toegevoegd`, 'success');
    fetchItems();
  }

  function toggleGeoAlert(value: boolean) {
    if (geoToggling) return;
    if (value) {
      setGeoPermModal(true); // show explanation first
    } else {
      doDisableGeo();
    }
  }

  async function doEnableGeo() {
    setGeoPermModal(false);
    setGeoToggling(true);
    try {
      const result = await startGeoAlertTask(user?.id ?? '');
      if (result === 'denied') {
        Alert.alert(
          'Locatietoegang geweigerd',
          'Ga naar Instellingen → Sous-Chef → Locatie en kies "Tijdens gebruik van app".',
        );
        setGeoEnabled(false);
      } else if (result === 'expo-go') {
        setGeoEnabled(true);
        showToast('Werkt volledig in de echte app — achtergrond tracking actief na installatie', 'info');
      } else {
        setGeoEnabled(true);
        showToast('Supermarktherkenning ingeschakeld', 'success');
      }
    } finally {
      setGeoToggling(false);
    }
  }

  async function doDisableGeo() {
    setGeoToggling(true);
    try {
      await stopGeoAlertTask();
      setGeoEnabled(false);
      showToast('Supermarktherkenning uitgeschakeld', 'info');
    } finally {
      setGeoToggling(false);
    }
  }

  const unchecked = items.filter(i => !i.checked);
  const checked = items.filter(i => i.checked);
  const allDone = items.length > 0 && unchecked.length === 0;

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
        {isGroceryList && (
          <View style={[styles.geoBanner, { backgroundColor: colors.white, borderBottomColor: colors.gray100 }]}>
            <View style={styles.geoLeft}>
              <Text style={styles.geoIcon}>🛒</Text>
              <View>
                <Text style={[styles.geoTitle, { color: colors.black }]}>Supermarktherkenning</Text>
                <Text style={[styles.geoSub, { color: colors.gray400 }]}>
                  {geoEnabled ? 'Stuurt WhatsApp als je aankomt' : 'Uit — tik om in te schakelen'}
                </Text>
              </View>
            </View>
            <Switch
              value={geoEnabled}
              onValueChange={toggleGeoAlert}
              disabled={geoToggling}
              trackColor={{ false: colors.gray200, true: Colors.yellow }}
              thumbColor={Colors.white}
            />
          </View>
        )}

        {loading ? (
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map(i => <SkeletonListCard key={i} />)}
          </View>
        ) : (
          <FlatList
            data={[...unchecked, ...checked]}
            keyExtractor={(i) => i.id}
            contentContainerStyle={styles.list}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchItems(); }} tintColor={Colors.yellow} />
            }
            ListHeaderComponent={
              allDone ? (
                <View style={styles.allDoneBanner}>
                  <Text style={styles.allDoneEmoji}>🎉</Text>
                  <Text style={styles.allDoneText}>Alles afgevinkt!</Text>
                </View>
              ) : unchecked.length > 0 ? (
                <Text style={styles.sectionLabel}>{unchecked.length} te doen · veeg links om te verwijderen</Text>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <View style={[styles.emptyIconBox, { backgroundColor: colors.gray100 }]}>
                  <Ionicons name="basket-outline" size={36} color={colors.gray400} />
                </View>
                <Text style={[styles.emptyTitle, { color: colors.black }]}>Lijst is leeg</Text>
                <Text style={[styles.emptyText, { color: colors.gray400 }]}>Voeg items toe via het veld hieronder, of stuur een WhatsApp-bericht.</Text>
              </View>
            }
            renderItem={({ item, index }) => {
              const isFirstChecked = item.checked && index === unchecked.length;
              return (
                <>
                  {isFirstChecked && checked.length > 0 && (
                    <Text style={[styles.sectionLabel, { marginTop: 20 }]}>
                      Afgevinkt ({checked.length})
                    </Text>
                  )}
                  <SwipeableItem
                    item={item}
                    onToggle={() => toggleItem(item)}
                    onDelete={() => deleteItem(item.id)}
                  />
                </>
              );
            }}
          />
        )}

        <View style={[styles.addRow, { backgroundColor: colors.white, borderTopColor: colors.gray100 }]}>
          <TextInput
            style={[styles.addInput, { color: colors.black, backgroundColor: colors.white }]}
            value={newItemText}
            onChangeText={setNewItemText}
            placeholder="Item toevoegen..."
            placeholderTextColor={colors.gray400}
            returnKeyType="done"
            onSubmitEditing={addItem}
          />
          <TouchableOpacity onPress={addItem} disabled={!newItemText.trim() || adding} activeOpacity={0.8}>
            <LinearGradient
              colors={newItemText.trim() ? ['#FCC10C', '#E5A800'] : [Colors.gray100, Colors.gray100]}
              style={styles.addButton}
            >
              {adding
                ? <ActivityIndicator size="small" color={Colors.black} />
                : <Ionicons name="add" size={22} color={newItemText.trim() ? Colors.black : Colors.gray400} />}
            </LinearGradient>
          </TouchableOpacity>
        </View>

        <Toast {...toastProps} />

        <Modal visible={geoPermModal} transparent animationType="fade" onRequestClose={() => setGeoPermModal(false)}>
          <View style={styles.modalOverlay}>
            <View style={[styles.permModal, { backgroundColor: colors.white }]}>
              <Text style={styles.permIcon}>📍</Text>
              <Text style={[styles.permTitle, { color: colors.black }]}>Locatietoegang nodig</Text>
              <Text style={[styles.permBody, { color: colors.gray600 }]}>
                Sous-Chef gebruikt je locatie om te detecteren wanneer je bij de supermarkt bent. Je krijgt dan automatisch een WhatsApp-bericht met je open boodschappen.{'\n\n'}De locatie wordt nooit opgeslagen of gedeeld.
              </Text>
              <TouchableOpacity style={styles.permBtn} onPress={doEnableGeo} activeOpacity={0.85}>
                <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.permBtnGrad}>
                  <Text style={styles.permBtnText}>Locatie toestaan</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={styles.permCancel} onPress={() => setGeoPermModal(false)}>
                <Text style={[styles.permCancelText, { color: colors.gray400 }]}>Niet nu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  container: { flex: 1, backgroundColor: Colors.offWhite },
  modalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  permModal: {
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 28, paddingBottom: 44, alignItems: 'center', gap: 12,
  },
  permIcon: { fontSize: 40, marginBottom: 4 },
  permTitle: { fontFamily: 'Inter_700Bold', fontSize: 20, textAlign: 'center' },
  permBody: { fontFamily: 'Inter_300Light', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  permBtn: { width: '100%', marginTop: 8 },
  permBtnGrad: {
    borderRadius: Radius.pill, paddingVertical: 16,
    alignItems: 'center',
  },
  permBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },
  permCancel: { paddingVertical: 12 },
  permCancelText: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  geoBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  geoLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  geoIcon: { fontSize: 22 },
  geoTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, marginBottom: 2 },
  geoSub: { fontFamily: 'Inter_300Light', fontSize: 12 },
  skeletonList: { padding: 16 },
  list: { padding: 16, paddingBottom: 16 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11,
    color: Colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10,
  },
  allDoneBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 16, marginBottom: 4,
  },
  allDoneEmoji: { fontSize: 24 },
  allDoneText: { fontFamily: 'Inter_700Bold', fontSize: 18, color: Colors.black },
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white,
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 15, marginBottom: 8,
    minHeight: 56, // Rule #5: min touch target
    ...Shadow.card,
  },
  itemCheckedContainer: { opacity: 0.7 },
  checkbox: {
    width: 26, height: 26, borderRadius: 8, borderWidth: 2,
    borderColor: Colors.gray200, marginRight: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxDone: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  itemText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.black },
  itemTextDone: { textDecorationLine: 'line-through', color: Colors.gray400, fontFamily: 'Inter_300Light' },
  deleteAction: {
    backgroundColor: '#ef4444', borderRadius: Radius.md, width: 72,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  emptyContainer: { alignItems: 'center', paddingVertical: 60, gap: 12, paddingHorizontal: 32 },
  emptyIconBox: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: Colors.gray100,
    justifyContent: 'center', alignItems: 'center',
  },
  emptyTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, color: Colors.black },
  emptyText: { fontFamily: 'Inter_300Light', fontSize: 14, color: Colors.gray400, textAlign: 'center', lineHeight: 21 },
  addRow: {
    flexDirection: 'row', padding: 14, backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.gray100, gap: 10, alignItems: 'center',
  },
  addInput: {
    flex: 1, backgroundColor: Colors.offWhite, borderRadius: Radius.md,
    paddingHorizontal: 14, paddingVertical: 13, // Rule #5: min 44pt
    fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.black,
  },
  addButton: {
    width: 48, height: 48, borderRadius: 14, // Rule #5: 48pt touch target
    justifyContent: 'center', alignItems: 'center',
  },
});
