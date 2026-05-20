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
  Linking,
  Pressable,
  InputAccessoryView,
  Share,
  KeyboardAvoidingView,
} from 'react-native';
import { Swipeable, GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

const ADD_INPUT_ACCESSORY_ID = 'sous-chef-add-input';

function haptic(style: 'light' | 'medium' | 'warning' = 'light') {
  if (Platform.OS === 'web') return;
  if (style === 'warning') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  else if (style === 'medium') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
}

function AnimatedCheckbox({ checked, onPress }: { checked: boolean; onPress: () => void }) {
  const scale = useRef(new Animated.Value(checked ? 1 : 0)).current;
  const prevChecked = useRef(checked);

  useEffect(() => {
    if (checked && !prevChecked.current) {
      scale.setValue(0);
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 200, friction: 8 }).start();
    } else if (!checked) {
      scale.setValue(1);
    }
    prevChecked.current = checked;
  }, [checked]);

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
  onLongPress,
  editingItemId,
  onEditSubmit,
}: {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
  onLongPress: () => void;
  editingItemId: string | null;
  onEditSubmit: (id: string, text: string) => void;
}) {
  const { colors } = useTheme();
  const swipeRef = useRef<Swipeable>(null);
  const [editText, setEditText] = useState(item.text);
  const isEditing = editingItemId === item.id;

  function handleDelete() {
    swipeRef.current?.close();
    onDelete();
  }

  function handleToggleFromSwipe() {
    swipeRef.current?.close();
    onToggle();
  }

  const renderLeftActions = (_prog: Animated.AnimatedInterpolation<number>, drag: Animated.AnimatedInterpolation<number>) => {
    const iconScale = drag.interpolate({ inputRange: [0, 80], outputRange: [0.7, 1], extrapolate: 'clamp' });
    return (
      <TouchableOpacity style={styles.checkAction} onPress={handleToggleFromSwipe} activeOpacity={0.8}>
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Ionicons name="checkmark" size={22} color={Colors.white} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  const renderRightActions = (_prog: Animated.AnimatedInterpolation<number>, drag: Animated.AnimatedInterpolation<number>) => {
    const iconScale = drag.interpolate({ inputRange: [-80, 0], outputRange: [1, 0.7], extrapolate: 'clamp' });
    return (
      <TouchableOpacity style={styles.deleteAction} onPress={handleDelete} activeOpacity={0.8}>
        <Animated.View style={{ transform: [{ scale: iconScale }] }}>
          <Ionicons name="trash-outline" size={20} color={Colors.white} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  return (
    <Swipeable
      ref={swipeRef}
      renderLeftActions={renderLeftActions}
      renderRightActions={renderRightActions}
      leftThreshold={60}
      rightThreshold={40}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableOpen={(direction) => {
        if (direction === 'left') {
          handleToggleFromSwipe();
        }
      }}
    >
      <Pressable
        style={({ pressed }) => [
          styles.item,
          { backgroundColor: colors.white },
          item.checked && { backgroundColor: colors.gray100 },
          pressed && { transform: [{ scale: 0.98 }] },
        ]}
        onPress={() => { haptic('light'); onToggle(); }}
        onLongPress={() => { haptic('medium'); onLongPress(); }}
      >
        <AnimatedCheckbox checked={item.checked} onPress={onToggle} />
        {isEditing ? (
          <TextInput
            style={[styles.itemText, { color: colors.black, flex: 1, borderBottomWidth: 1, borderBottomColor: Colors.yellow, padding: 0 }]}
            value={editText}
            onChangeText={setEditText}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => onEditSubmit(item.id, editText)}
            onBlur={() => onEditSubmit(item.id, editText)}
            selectionColor={Colors.yellow}
          />
        ) : (
          <Text style={[styles.itemText, { color: colors.black }, item.checked && { color: colors.gray400, textDecorationLine: 'line-through' }]}>{item.text}</Text>
        )}
        {!item.checked && !isEditing && (
          <Ionicons name="reorder-three" size={18} color={colors.gray200} />
        )}
      </Pressable>
    </Swipeable>
  );
}

const URL_REGEX = /https?:\/\/[^\s]+/i;
const KEY_VALUE_REGEX = /^(.+?):\s*(.+)$/;

function LinkItemRow({ item, colors }: { item: ListItem; colors: any }) {
  const urlMatch = item.text.match(URL_REGEX);
  const url = urlMatch?.[0];
  return (
    <View style={[styles.item, { backgroundColor: colors.white }]}>
      <Ionicons name="link-outline" size={18} color={Colors.gray400} style={{ marginRight: 10 }} />
      {url ? (
        <TouchableOpacity onPress={() => Linking.openURL(url)} style={{ flex: 1 }} activeOpacity={0.7}>
          <Text style={[styles.itemText, { color: '#4A90D8', textDecorationLine: 'underline' }]} numberOfLines={2}>{item.text}</Text>
        </TouchableOpacity>
      ) : (
        <Text style={[styles.itemText, { color: colors.black }]}>{item.text}</Text>
      )}
    </View>
  );
}

function TipItemRow({ item, colors }: { item: ListItem; colors: any }) {
  const match = item.text.match(KEY_VALUE_REGEX);
  if (match) {
    return (
      <View style={[styles.item, { backgroundColor: colors.white }]}>
        <Ionicons name="bulb-outline" size={18} color={Colors.gray400} style={{ marginRight: 10 }} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
          <Text style={[styles.itemText, { color: Colors.gray400, fontFamily: 'Inter_600SemiBold' }]}>{match[1].trim()}:</Text>
          <Text style={[styles.itemText, { color: colors.black }]}>{match[2].trim()}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.item, { backgroundColor: colors.white }]}>
      <Ionicons name="bulb-outline" size={18} color={Colors.gray400} style={{ marginRight: 10 }} />
      <Text style={[styles.itemText, { color: colors.black }]}>{item.text}</Text>
    </View>
  );
}

export default function ListDetailScreen() {
  const { id, name, emoji, list_type: listTypeParam } = useLocalSearchParams<{ id: string; name: string; emoji: string; list_type?: string }>();
  const navigation = useNavigation();
  const { colors } = useTheme();
  const { user } = useUser();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newItemText, setNewItemText] = useState('');
  const [adding, setAdding] = useState(false);
  const [listType, setListType] = useState<string>(listTypeParam ?? 'checklist');
  const { toastProps, show: showToast } = useToast();

  const [pendingDelete, setPendingDelete] = useState<{ item: ListItem; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [doneExpanded, setDoneExpanded] = useState(true);

  const prevItemCount = useRef(0);
  const newItemAnim = useRef(new Animated.Value(0)).current;
  const newItemSlide = useRef(new Animated.Value(40)).current;

  const [batchDeleteVisible, setBatchDeleteVisible] = useState(false);
  const batchDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showBatchDeleteBanner() {
    setBatchDeleteVisible(true);
    if (batchDeleteTimerRef.current) clearTimeout(batchDeleteTimerRef.current);
    batchDeleteTimerRef.current = setTimeout(() => setBatchDeleteVisible(false), 7000);
  }

  const isGroceryList = isBoodschappenlijst(name ?? '');
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoToggling, setGeoToggling] = useState(false);
  const [geoPermModal, setGeoPermModal] = useState(false);

  useEffect(() => {
    if (!isGroceryList) return;
    isGeoAlertEnabled().then(setGeoEnabled);
  }, [isGroceryList]);

  function shareList() {
    const lines = items.map(i => `${i.checked ? '✓' : '○'} ${i.text}`).join('\n');
    const text = `${emoji || '📝'} ${name}\n\n${lines}`;
    Share.share({ message: text, title: name });
  }

  useEffect(() => {
    const badge = listType === 'links' ? ' 🔗' : listType === 'tips' ? ' 💡' : '';
    navigation.setOptions({
      title: `${emoji || '📝'} ${name}${badge}`,
      headerRight: () => (
        <TouchableOpacity onPress={shareList} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginRight: 4 }}>
          <Ionicons name="share-outline" size={22} color={Colors.black} />
        </TouchableOpacity>
      ),
    });
  }, [name, emoji, listType, items]);

  useEffect(() => {
    if (!id) return;
    supabase.from('lists').select('list_type').eq('id', id).single().then(({ data }) => {
      if (data?.list_type) setListType(data.list_type);
    });
  }, [id]);

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('list_items').select('*').eq('list_id', id).order('created_at', { ascending: true });
    if (data) {
      if (data.length > prevItemCount.current && prevItemCount.current > 0) {
        newItemAnim.setValue(0);
        newItemSlide.setValue(40);
        Animated.parallel([
          Animated.timing(newItemAnim, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(newItemSlide, { toValue: 0, duration: 280, useNativeDriver: true }),
        ]).start();
      }
      prevItemCount.current = data.length;
      setItems(data);
    }
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
    if (!item.checked) {
      showToast('Afgevinkt ✓', 'success');
      showBatchDeleteBanner();
    }
    fetchItems();
  }

  async function checkAllItems() {
    const unchecked = items.filter(i => !i.checked);
    if (unchecked.length === 0) return;
    if (Platform.OS !== 'web') {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
    const ids = unchecked.map(i => i.id);
    setItems(prev => prev.map(i => ids.includes(i.id) ? { ...i, checked: true } : i));
    await supabase.from('list_items').update({ checked: true }).in('id', ids);
    showToast(`${ids.length} item${ids.length > 1 ? 's' : ''} afgevinkt`, 'success');
    showBatchDeleteBanner();
  }

  function deleteItem(itemId: string) {
    haptic('warning');
    const target = items.find(i => i.id === itemId);
    if (!target) return;

    setItems(prev => prev.filter(i => i.id !== itemId));

    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      supabase.from('list_items').delete().eq('id', pendingDelete.item.id);
    }

    const timer = setTimeout(async () => {
      await supabase.from('list_items').delete().eq('id', itemId);
      setPendingDelete(null);
    }, 3000);

    setPendingDelete({ item: target, timer });
  }

  function undoDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    setItems(prev => {
      const without = prev.filter(i => i.id !== pendingDelete.item.id);
      return [...without, pendingDelete.item].sort((a, b) => a.created_at.localeCompare(b.created_at));
    });
    setPendingDelete(null);
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

  async function saveInlineEdit(itemId: string, text: string) {
    setEditingItemId(null);
    const trimmed = text.trim();
    if (!trimmed) return;
    await supabase.from('list_items').update({ text: trimmed }).eq('id', itemId);
    fetchItems();
  }

  function confirmBatchDelete() {
    const checkedItems = items.filter(i => i.checked);
    if (checkedItems.length === 0) return;
    Alert.alert(
      `${checkedItems.length} item${checkedItems.length > 1 ? 's' : ''} verwijderen?`,
      'Alle afgevinkte items worden verwijderd.',
      [
        { text: 'Annuleer', style: 'cancel' },
        {
          text: 'Verwijder',
          style: 'destructive',
          onPress: async () => {
            haptic('warning');
            const ids = checkedItems.map(i => i.id);
            await supabase.from('list_items').delete().in('id', ids);
            showToast(`${ids.length} item${ids.length > 1 ? 's' : ''} verwijderd`, 'info');
            fetchItems();
          },
        },
      ],
    );
  }

  function toggleGeoAlert(value: boolean) {
    if (geoToggling) return;
    if (value) {
      setGeoPermModal(true);
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

  useEffect(() => {
    if (checked.length === 0) {
      setBatchDeleteVisible(false);
      if (batchDeleteTimerRef.current) clearTimeout(batchDeleteTimerRef.current);
    }
  }, [checked.length]);

  const totalCount = items.length;
  const checkedCount = checked.length;
  const progress = totalCount > 0 ? checkedCount / totalCount : 0;

  const filteredUnchecked = searchQuery.trim()
    ? unchecked.filter(i => i.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : unchecked;
  const filteredChecked = searchQuery.trim()
    ? checked.filter(i => i.text.toLowerCase().includes(searchQuery.toLowerCase()))
    : checked;
  const DONE_SENTINEL_ID = '__done_header__';
  const doneSentinel = { id: DONE_SENTINEL_ID, text: '', checked: false, list_id: '', created_at: '' };
  const flatItems: any[] = [
    ...filteredUnchecked,
    ...(filteredChecked.length > 0 ? [doneSentinel] : []),
    ...(doneExpanded ? filteredChecked : []),
  ];

  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 44 : 0}>
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

        {/* Progress bar */}
        {!loading && totalCount > 0 && (
          <View style={{ height: 4, backgroundColor: '#E0E0E0', marginHorizontal: 20, borderRadius: 2, marginTop: 8, marginBottom: 4 }}>
            <View style={{ height: 4, backgroundColor: progress === 1 ? '#4CAF50' : '#FCC10C', width: `${progress * 100}%` as any, borderRadius: 2 }} />
          </View>
        )}

        {/* Search bar + Alles afvinken */}
        {!loading && items.length > 0 && (
          <View style={[styles.searchRow]}>
            <View style={[styles.searchBar, { backgroundColor: colors.white, borderColor: colors.gray100, flex: 1 }]}>
              <Ionicons name="search-outline" size={16} color={colors.gray400} />
              <TextInput
                style={[styles.searchInput, { color: colors.black }]}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Zoeken in lijst..."
                placeholderTextColor={colors.gray400}
                returnKeyType="search"
                clearButtonMode="while-editing"
              />
            </View>
            {unchecked.length > 0 && (
              <TouchableOpacity
                onPress={checkAllItems}
                style={[styles.checkAllBtn, { backgroundColor: Colors.yellow }]}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-done" size={14} color={Colors.black} />
                <Text style={styles.checkAllText}>Alles</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Batch delete button */}
        {!loading && batchDeleteVisible && checked.length > 0 && (
          <TouchableOpacity
            style={[styles.batchDeleteBtn, { backgroundColor: '#FEE2E2' }]}
            onPress={confirmBatchDelete}
            activeOpacity={0.8}
          >
            <Ionicons name="trash-outline" size={15} color="#EF4444" />
            <Text style={styles.batchDeleteText}>Verwijder afgevinkte items ({checked.length})</Text>
          </TouchableOpacity>
        )}

        {loading ? (
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map(i => <SkeletonListCard key={i} />)}
          </View>
        ) : (
          <FlatList
            data={flatItems}
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
              ) : filteredUnchecked.length > 0 ? (
                <Text style={styles.sectionLabel}>{filteredUnchecked.length} te doen · veeg links om af te vinken</Text>
              ) : null
            }
            ListEmptyComponent={
              searchQuery.trim() ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="search-outline" size={36} color={colors.gray400} />
                  <Text style={[styles.emptyTitle, { color: colors.black }]}>Geen resultaten</Text>
                  <Text style={[styles.emptyText, { color: colors.gray400 }]}>Geen items gevonden voor "{searchQuery}".</Text>
                </View>
              ) : (
                <View style={styles.emptyContainer}>
                  <View style={[styles.emptyIconBox, { backgroundColor: colors.gray100 }]}>
                    <Ionicons name="basket-outline" size={36} color={colors.gray400} />
                  </View>
                  <Text style={[styles.emptyTitle, { color: colors.black }]}>Lijst is leeg</Text>
                  <Text style={[styles.emptyText, { color: colors.gray400 }]}>Voeg items toe via het veld hieronder, of stuur een WhatsApp-bericht.</Text>
                </View>
              )
            }
            renderItem={({ item, index }) => {
              if (item.id === DONE_SENTINEL_ID) {
                return (
                  <TouchableOpacity
                    style={[styles.doneSectionHeader, { marginTop: 28 }]}
                    onPress={() => setDoneExpanded(v => !v)}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.sectionLabel}>Gedaan ({filteredChecked.length})</Text>
                    <Ionicons
                      name={doneExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={Colors.gray400}
                    />
                  </TouchableOpacity>
                );
              }
              if (listType === 'links') {
                return <LinkItemRow item={item} colors={colors} />;
              }
              if (listType === 'tips') {
                return <TipItemRow item={item} colors={colors} />;
              }
              const isLastItem = index === flatItems.length - 1;
              const itemView = (
                <SwipeableItem
                  item={item}
                  onToggle={() => toggleItem(item)}
                  onDelete={() => deleteItem(item.id)}
                  onLongPress={() => setEditingItemId(item.id)}
                  editingItemId={editingItemId}
                  onEditSubmit={saveInlineEdit}
                />
              );
              return isLastItem ? (
                <Animated.View style={{ opacity: newItemAnim, transform: [{ translateX: newItemSlide }] }}>
                  {itemView}
                </Animated.View>
              ) : itemView;
            }}
          />
        )}

        <View style={[styles.addRow, { backgroundColor: colors.offWhite, borderTopColor: colors.gray100, paddingBottom: insets.bottom > 0 ? insets.bottom : 14 }]}>
          <View style={[styles.addPill, { backgroundColor: colors.gray100 }]}>
            <TextInput
              style={[styles.addInput, { color: colors.black }]}
              value={newItemText}
              onChangeText={setNewItemText}
              placeholder="Item toevoegen..."
              placeholderTextColor={colors.gray400}
              returnKeyType="done"
              onSubmitEditing={addItem}
              inputAccessoryViewID={Platform.OS === 'ios' ? ADD_INPUT_ACCESSORY_ID : undefined}
            />
            <TouchableOpacity onPress={addItem} disabled={!newItemText.trim() || adding} activeOpacity={0.8}>
              <LinearGradient
                colors={newItemText.trim() ? ['#FCC10C', '#E5A800'] : [Colors.gray200, Colors.gray200]}
                style={styles.addButton}
              >
                {adding
                  ? <ActivityIndicator size="small" color={Colors.black} />
                  : <Ionicons name="arrow-up" size={18} color={newItemText.trim() ? Colors.black : Colors.gray400} />}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>

        {Platform.OS === 'ios' && (
          <InputAccessoryView nativeID={ADD_INPUT_ACCESSORY_ID}>
            <View style={[styles.klaarBar, { backgroundColor: colors.white, borderTopColor: colors.gray100 }]}>
              <TouchableOpacity onPress={() => Keyboard.dismiss()} style={styles.klaarBtn} activeOpacity={0.7}>
                <Text style={[styles.klaarText, { color: Colors.black }]}>Klaar</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        )}

        {pendingDelete && (
          <View style={[styles.snackbar, { bottom: (insets.bottom > 0 ? insets.bottom : 14) + 80 }]}>
            <Text style={styles.snackbarText}>Item verwijderd</Text>
            <TouchableOpacity onPress={undoDelete} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.snackbarUndo}>Ongedaan maken</Text>
            </TouchableOpacity>
          </View>
        )}

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
      </KeyboardAvoidingView>
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
  skeletonList: { padding: 20 },
  list: { padding: 20, paddingBottom: 20 },
  sectionLabel: {
    fontFamily: 'Inter_600SemiBold', fontSize: 11,
    color: Colors.gray400, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 12,
  },
  allDoneBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 20, marginBottom: 6,
  },
  allDoneEmoji: { fontSize: 26 },
  allDoneText: { fontFamily: 'Inter_700Bold', fontSize: 18, color: Colors.black },
  item: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.white,
    borderRadius: 16, paddingHorizontal: 16, paddingVertical: 16, marginBottom: 10,
    minHeight: 60,
    ...Shadow.card,
  },
  itemCheckedContainer: { opacity: 0.7 },
  checkbox: {
    width: 28, height: 28, borderRadius: 9, borderWidth: 2,
    borderColor: Colors.gray200, marginRight: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxDone: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  itemText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.black },
  itemTextDone: { textDecorationLine: 'line-through', color: Colors.gray400, fontFamily: 'Inter_300Light' },
  checkAction: {
    backgroundColor: '#22C55E', borderRadius: Radius.md, width: 72,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8, marginRight: 4,
  },
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
    paddingHorizontal: 14, paddingTop: 10,
    backgroundColor: Colors.white,
    borderTopWidth: 1, borderTopColor: Colors.gray100,
  },
  addPill: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Radius.pill, paddingLeft: 18, paddingRight: 6, paddingVertical: 6,
    gap: 8,
  },
  addInput: {
    flex: 1,
    fontFamily: 'Inter_400Regular', fontSize: 15, color: Colors.black,
    paddingVertical: 10,
  },
  addButton: {
    width: 40, height: 40, borderRadius: Radius.pill,
    justifyContent: 'center', alignItems: 'center',
  },
  snackbar: {
    position: 'absolute', left: 16, right: 16,
    backgroundColor: '#1A1A1A', borderRadius: Radius.lg,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 14,
    ...Shadow.strong,
  },
  snackbarText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.white },
  snackbarUndo: { fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.yellow },
  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginTop: 12, marginBottom: 6,
  },
  searchBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: Radius.md, borderWidth: 1,
  },
  searchInput: {
    flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, padding: 0,
  },
  checkAllBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: Radius.md,
  },
  checkAllText: {
    fontFamily: 'Inter_600SemiBold', fontSize: 13, color: Colors.black,
  },
  batchDeleteBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginHorizontal: 16, marginTop: 4, marginBottom: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: Radius.md,
  },
  batchDeleteText: {
    fontFamily: 'Inter_600SemiBold', fontSize: 13, color: '#EF4444',
  },
  doneSectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 12,
  },
  klaarBar: {
    flexDirection: 'row', justifyContent: 'flex-end',
    paddingHorizontal: 16, paddingVertical: 8,
    borderTopWidth: 1,
  },
  klaarBtn: {
    paddingHorizontal: 16, paddingVertical: 6,
    borderRadius: Radius.pill, backgroundColor: Colors.yellow,
  },
  klaarText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
