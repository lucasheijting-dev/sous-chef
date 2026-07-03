import { useEffect, useState, useCallback, useRef } from 'react';
// DraggableFlatList temporarily replaced with FlatList to diagnose rendering issue
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
  LayoutAnimation,
  Platform,
  Switch,
  Alert,
  Modal,
  Linking,
  Pressable,
  InputAccessoryView,
  Share,
  KeyboardAvoidingView,
  Image,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
// GestureHandlerRootView removed with DraggableFlatList
import { SwipeDeleteRow } from '@/components/SwipeDeleteRow';
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
import Confetti from '@/components/Confetti';

const ADD_INPUT_ACCESSORY_ID = 'sous-chef-add-input';
const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

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
    <TouchableOpacity onPress={handlePress} hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }} activeOpacity={1} style={{ padding: 2 }}>
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
  isFirst,
  tapToEdit,
  onAddPhoto,
  onViewImage,
}: {
  item: ListItem;
  onToggle: () => void;
  onDelete: () => void;
  onLongPress: () => void;
  editingItemId: string | null;
  onEditSubmit: (id: string, text: string) => void;
  isFirst?: boolean;
  tapToEdit?: boolean;
  onAddPhoto?: () => void;
  onViewImage?: (url: string) => void;
}) {
  const { colors } = useTheme();
  const [editText, setEditText] = useState(item.text);
  const isEditing = editingItemId === item.id;
  const rowBounce = useRef(new Animated.Value(1)).current;
  const prevChecked = useRef(item.checked);

  useEffect(() => {
    if (item.checked !== prevChecked.current) {
      Animated.sequence([
        Animated.spring(rowBounce, { toValue: item.checked ? 0.96 : 1.03, useNativeDriver: true, speed: 80, bounciness: 0 }),
        Animated.spring(rowBounce, { toValue: 1, useNativeDriver: true, tension: 180, friction: 7 }),
      ]).start();
    }
    prevChecked.current = item.checked;
  }, [item.checked]);

  return (
    <Animated.View style={{ transform: [{ scale: rowBounce }] }}>
      <SwipeDeleteRow onDelete={onDelete}>
        <Pressable
          style={({ pressed }) => [
            styles.item,
            { backgroundColor: colors.white, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: isFirst ? 'transparent' : colors.hairline },
            item.checked && { backgroundColor: colors.gray100 },
            pressed && { transform: [{ scale: 0.98 }] },
          ]}
          onPress={() => { haptic('light'); if (tapToEdit) onLongPress(); else onToggle(); }}
          onLongPress={() => { haptic('medium'); onLongPress(); }}
        >
          {!tapToEdit && <AnimatedCheckbox checked={item.checked} onPress={onToggle} />}
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
          {!isEditing && item.list_item_sources && item.list_item_sources.length > 0 && (
            <Text style={{ fontSize: 13, marginRight: 2 }}>🍽️</Text>
          )}
          {!isEditing && (
            <TouchableOpacity
              onPress={() => item.image_url ? onViewImage?.(item.image_url) : onAddPhoto?.()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ marginRight: 4 }}
              activeOpacity={0.7}
            >
              {item.image_url
                ? <Image source={{ uri: item.image_url }} style={{ width: 26, height: 26, borderRadius: 5 }} />
                : <Ionicons name="camera-outline" size={16} color={colors.gray400} />
              }
            </TouchableOpacity>
          )}
        </Pressable>
      </SwipeDeleteRow>
    </Animated.View>
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


  const [batchDeleteVisible, setBatchDeleteVisible] = useState(false);
  const batchDeleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [confettiActive, setConfettiActive] = useState(false);
  const prevAllDone = useRef(false);

  function showBatchDeleteBanner() {
    setBatchDeleteVisible(true);
    if (batchDeleteTimerRef.current) clearTimeout(batchDeleteTimerRef.current);
    batchDeleteTimerRef.current = setTimeout(() => setBatchDeleteVisible(false), 7000);
  }

  const isGroceryList = isBoodschappenlijst(name ?? '');
  const [geoEnabled, setGeoEnabled] = useState(false);
  const [geoToggling, setGeoToggling] = useState(false);
  const [geoPermModal, setGeoPermModal] = useState(false);

  const [members, setMembers] = useState<{ user_id: string; role: string; users: { display_name?: string; whatsapp_number: string } | null }[]>([]);
  const [inviteModalVisible, setInviteModalVisible] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');
  const [inviteUrlLoading, setInviteUrlLoading] = useState(false);
  const [inviteError, setInviteError] = useState(false);

  const [recipeModalVisible, setRecipeModalVisible] = useState(false);
  const [recipeUrl, setRecipeUrl] = useState('');
  const [recipeImporting, setRecipeImporting] = useState(false);
  const [recipeResult, setRecipeResult] = useState<{ title: string; added: string[]; merged: string[]; listName: string; listEmoji: string } | null>(null);
  const [recipeError, setRecipeError] = useState<string | null>(null);
  const [recipeServings, setRecipeServings] = useState<number | null>(null);

  const [imageViewUrl, setImageViewUrl] = useState<string | null>(null);
  const [uploadingImageItemId, setUploadingImageItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!isGroceryList) return;
    isGeoAlertEnabled().then(setGeoEnabled);
  }, [isGroceryList]);

  function shareList() {
    const open = items.filter(i => !i.checked);
    const done = items.filter(i => i.checked);
    const lines = [
      ...open.map(i => `○ ${i.text}`),
      ...(done.length > 0 ? [`\n✓ Afgevinkt (${done.length})`] : []),
    ].join('\n');
    const text = `${emoji || '📝'} ${name}\n\n${lines}`;
    haptic('light');
    showToast(`${open.length} open item${open.length !== 1 ? 's' : ''} gedeeld`, 'success');
    Share.share({ message: text, title: name });
  }

  useEffect(() => {
    const badge = listType === 'links' ? ' 🔗' : listType === 'tips' ? ' 💡' : '';
    navigation.setOptions({
      title: `${name}${badge}`,
      headerBackTitle: 'Terug',
      headerTintColor: Colors.yellow,
      headerRight: () => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginRight: 4 }}>
          <TouchableOpacity onPress={openInviteModal} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' }}>
              <Ionicons name="person-add-outline" size={17} color={Colors.black} />
            </View>
          </TouchableOpacity>
          {items.length > 0 && (
            <TouchableOpacity onPress={shareList} hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: '#F2F2F7', justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="share-outline" size={17} color={Colors.black} />
              </View>
            </TouchableOpacity>
          )}
        </View>
      ),
    });
  }, [name, emoji, listType, items]);

  useEffect(() => {
    if (!id) return;
    supabase.from('lists').select('list_type').eq('id', id).single().then(({ data }) => {
      if (data?.list_type) setListType(data.list_type);
    });
  }, [id]);

  async function fetchMembers() {
    if (!user || user.id === 'dev') return;
    const { data } = await supabase
      .from('list_members')
      .select('user_id, role, users(display_name, whatsapp_number)')
      .eq('list_id', id);
    setMembers((data as any) ?? []);
  }

  const fetchItems = useCallback(async () => {
    const { data } = await supabase
      .from('list_items')
      .select('*')
      .eq('list_id', id)
      .order('created_at', { ascending: true });
    if (data) {
      // Fetch recipe sources separately so a missing FK doesn't kill the main query
      const { data: sources } = await supabase
        .from('list_item_sources')
        .select('list_item_id, recipe_id, recipes(title)')
        .in('list_item_id', data.map(i => i.id));
      const sourceMap = new Map<string, { recipe_id: string; recipes: { title: string } | null }>();
      for (const src of sources ?? []) {
        sourceMap.set((src as any).list_item_id, src as any);
      }
      const enriched = data.map(item => ({
        ...item,
        list_item_sources: sourceMap.has(item.id) ? [sourceMap.get(item.id)] : [],
      }));

      setItems(enriched as any);
    }
    setLoading(false);
    setRefreshing(false);
  }, [id]);

  useEffect(() => {
    fetchItems();
    fetchMembers();
    const channel = supabase.channel(`list-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'list_items', filter: `list_id=eq.${id}` }, fetchItems)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [id, fetchItems]);

  async function toggleItem(item: ListItem) {
    haptic('light');
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, checked: !item.checked } : i));
    await supabase.from('list_items').update({ checked: !item.checked }).eq('id', item.id);
    if (!item.checked) {
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

  async function uncheckAllItems() {
    const checked = items.filter(i => i.checked);
    if (checked.length === 0) return;
    if (Platform.OS !== 'web') haptic('light');
    const ids = checked.map(i => i.id);
    setItems(prev => prev.map(i => ids.includes(i.id) ? { ...i, checked: false } : i));
    await supabase.from('list_items').update({ checked: false }).in('id', ids);
    showToast('Lijst teruggezet', 'success');
  }

  function deleteItem(itemId: string) {
    haptic('warning');
    const itemToDelete = items.find(i => i.id === itemId);
    if (!itemToDelete) return;
    if (pendingDelete) {
      clearTimeout(pendingDelete.timer);
      fetch(`${API_BASE}/lists/items/${pendingDelete.item.id}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {});
      setPendingDelete(null);
    }
    setItems(prev => prev.filter(i => i.id !== itemId));
    const timer = setTimeout(() => {
      fetch(`${API_BASE}/lists/items/${itemId}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {});
      setPendingDelete(null);
    }, 4000);
    setPendingDelete({ item: itemToDelete, timer });
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



  async function addPhotoToItem(itemId: string) {
    if (!user || uploadingImageItemId) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      exif: false,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    setUploadingImageItemId(itemId);
    try {
      const asset = result.assets[0];
      const res = await fetch(`${API_BASE}/lists/items/${itemId}/image?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: asset.base64, mime_type: asset.mimeType ?? 'image/jpeg' }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;
      if (data?.image_url) {
        setItems(prev => prev.map(i => i.id === itemId ? { ...i, image_url: data.image_url } : i));
      }
    } finally {
      setUploadingImageItemId(null);
    }
  }

  async function addItem() {
    const text = newItemText.trim();
    if (!text) return;
    haptic('medium');
    const tempId = `temp_${Date.now()}`;
    const optimistic = { id: tempId, list_id: id as string, text, checked: false, created_at: new Date().toISOString() };
    setItems(prev => [...prev, optimistic]);
    setNewItemText('');
    Keyboard.dismiss();
    setAdding(true);
    await supabase.from('list_items').insert({ list_id: id, text, checked: false });
    setAdding(false);
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
            setItems(prev => prev.filter(i => !i.checked));
            await Promise.all(ids.map(id => fetch(`${API_BASE}/lists/items/${id}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {})));
            showToast(`${ids.length} item${ids.length > 1 ? 's' : ''} verwijderd`, 'info');
            fetchItems();
          },
        },
      ],
    );
  }

  async function openInviteModal() {
    setInviteModalVisible(true);
    setInviteUrl('');
    setInviteError(false);
    setInviteUrlLoading(true);
    try {
      const res = await fetch(
        `${API_BASE}/sharing/invite-link?list_id=${id}&user_id=${user!.id}&list_name=${encodeURIComponent(name ?? '')}&list_emoji=${encodeURIComponent(emoji ?? '📝')}`
      );
      const data = await res.json();
      if (data.url) {
        setInviteUrl(data.url);
      } else {
        setInviteError(true);
      }
    } catch {
      setInviteError(true);
    }
    finally { setInviteUrlLoading(false); }
  }

  async function importRecipeFromApp() {
    const url = recipeUrl.trim();
    if (!url || !user?.id) return;
    setRecipeImporting(true);
    setRecipeResult(null);
    setRecipeError(null);
    try {
      const res = await fetch(`${API_BASE}/recipe/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, listId: id, url, scalingHint: recipeServings ? `voor ${recipeServings} personen` : null }),
      });
      const data = await res.json();
      if (data.ok) {
        setRecipeResult(data);
        setRecipeUrl('');
        fetchItems();
      } else {
        setRecipeError(data.error ?? 'Importeren mislukt. Probeer een ander recept-linkje.');
      }
    } catch {
      setRecipeError('Kon de server niet bereiken. Controleer je verbinding.');
    } finally {
      setRecipeImporting(false);
    }
  }

  function closeRecipeModal() {
    setRecipeModalVisible(false);
    setRecipeUrl('');
    setRecipeResult(null);
    setRecipeError(null);
    setRecipeServings(null);
  }

  async function deleteRecipeGroup(recipeId: string) {
    await fetch(`${API_BASE}/lists/recipes/${recipeId}?user_id=${user?.id}`, { method: 'DELETE' }).catch(() => {});
    fetchItems();
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
    if (allDone && !prevAllDone.current) {
      haptic('warning');
      setConfettiActive(true);
      setTimeout(() => setConfettiActive(false), 3500);
    }
    prevAllDone.current = allDone;
  }, [allDone]);

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

  // Group unchecked items by recipe
  const recipeGroups = new Map<string, { title: string; items: typeof filteredUnchecked }>();
  const ungroupedUnchecked: typeof filteredUnchecked = [];
  for (const item of filteredUnchecked) {
    const src = item.list_item_sources?.[0];
    if (src?.recipe_id && src.recipes?.title) {
      if (!recipeGroups.has(src.recipe_id)) recipeGroups.set(src.recipe_id, { title: src.recipes.title, items: [] });
      recipeGroups.get(src.recipe_id)!.items.push(item);
    } else {
      ungroupedUnchecked.push(item);
    }
  }

  const flatItems: any[] = [];
  for (const [recipeId, { title, items: rItems }] of recipeGroups) {
    flatItems.push({ id: `__recipe_${recipeId}__`, type: 'recipe_header', recipeId, title });
    flatItems.push(...rItems);
  }
  flatItems.push(...ungroupedUnchecked);
  if (filteredChecked.length > 0) flatItems.push(doneSentinel);
  if (doneExpanded) flatItems.push(...filteredChecked);

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + (Platform.OS === 'ios' ? 44 : 24)}>
      <View style={[styles.container, { backgroundColor: colors.offWhite }]}>
        <Confetti active={confettiActive} />
        {isGroceryList && (
          <View style={[styles.geoBanner, { backgroundColor: colors.white, borderBottomColor: colors.gray100 }]}>
            <View style={styles.geoLeft}>
              <Text style={styles.geoIcon}>🛒</Text>
              <View>
                <Text style={[styles.geoTitle, { color: colors.black }]}>Supermarktherkenning</Text>
                <Text style={[styles.geoSub, { color: colors.gray400 }]}>
                  {geoEnabled ? 'Je krijgt een melding als je een supermarkt nadert' : 'Melding als je een supermarkt nadert'}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 8, marginBottom: 4, gap: 8 }}>
            <View style={{ flex: 1, height: 4, backgroundColor: colors.gray200, borderRadius: 2 }}>
              <View style={{ height: 4, backgroundColor: progress === 1 ? '#4CAF50' : Colors.yellow, width: `${progress * 100}%` as any, borderRadius: 2 }} />
            </View>
            <Text style={{ fontFamily: 'Inter_600SemiBold', fontSize: 11, color: Colors.gray400 }}>
              {checkedCount}/{totalCount}
            </Text>
          </View>
        )}

        {/* Search bar (only when 10+ items) + Alles afvinken */}
        {!loading && items.length > 0 && (
          <View style={[styles.searchRow, items.length < 10 && { justifyContent: 'flex-end' }]}>
            {items.length >= 10 && (
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
            )}
            {unchecked.length > 0 && listType !== 'tips' && listType !== 'links' && (
              <TouchableOpacity
                onPress={checkAllItems}
                style={[styles.checkAllBtn, { backgroundColor: Colors.yellow }]}
                activeOpacity={0.8}
              >
                <Ionicons name="checkmark-done" size={14} color={Colors.black} />
                <Text style={styles.checkAllText}>Alles</Text>
              </TouchableOpacity>
            )}
            {allDone && listType !== 'tips' && listType !== 'links' && (
              <TouchableOpacity
                onPress={uncheckAllItems}
                style={[styles.checkAllBtn, { backgroundColor: colors.gray100 }]}
                activeOpacity={0.8}
              >
                <Ionicons name="refresh-outline" size={14} color={colors.black} />
                <Text style={[styles.checkAllText, { color: colors.black }]}>Terugzetten</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Members row — only shown when there are actual members */}
        {members.length > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 6 }}>
            <Ionicons name="people-outline" size={13} color={colors.gray400} />
            {members.map(m => {
              const memberName = m.users?.display_name ?? m.users?.whatsapp_number ?? '?';
              const memberPhone = m.users?.whatsapp_number;
              const initials = memberName.slice(0, 2).toUpperCase();
              return (
                <TouchableOpacity key={m.user_id} onLongPress={() => Alert.alert(memberName, memberPhone ?? '')} activeOpacity={0.8} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: Colors.yellow, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 10, color: Colors.black }}>{initials}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {loading ? (
          <View style={styles.skeletonList}>
            {[0, 1, 2, 3].map(i => <SkeletonListCard key={i} />)}
          </View>
        ) : (
          <View style={{ flex: 1 }}>
          <View style={[styles.itemCard, { backgroundColor: colors.surface }, Platform.OS === 'android' && { borderRadius: 0, overflow: 'visible', elevation: 0 }]}>
          <FlatList
            data={flatItems}
            keyExtractor={(i) => i.id}
            style={{ flex: 1 }}
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
                <Text style={styles.sectionLabel}>{filteredUnchecked.length} te doen</Text>
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
            renderItem={({ item, index }: { item: any; index: number }) => {
              if (item.type === 'recipe_header') {
                return (
                  <View style={[styles.recipeGroupHeader, { borderBottomColor: colors.gray100 }]}>
                    <Text style={[styles.recipeGroupTitle, { color: colors.gray400 }]} numberOfLines={1}>{item.title}</Text>
                    <TouchableOpacity onPress={() => deleteRecipeGroup(item.recipeId)} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }} activeOpacity={0.6}>
                      <Ionicons name="trash-outline" size={15} color={colors.gray400} />
                    </TouchableOpacity>
                  </View>
                );
              }
              if (item.id === DONE_SENTINEL_ID) {
                return (
                  <View style={[styles.doneSectionHeader, { marginTop: 28 }]}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}
                      onPress={() => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setDoneExpanded(v => !v); }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.doneSectionLabel}>Afgevinkt ({filteredChecked.length})</Text>
                      <Ionicons name={doneExpanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.gray400} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={confirmBatchDelete}
                      hitSlop={{ top: 8, bottom: 8, left: 12, right: 4 }}
                      activeOpacity={0.6}
                    >
                      <Ionicons name="trash-outline" size={17} color="#EF4444" />
                    </TouchableOpacity>
                  </View>
                );
              }
              if (listType === 'links') {
                return <LinkItemRow item={item} colors={colors} />;
              }
              const isTips = listType === 'tips';
              return (
                <SwipeableItem
                  item={item}
                  onToggle={() => toggleItem(item)}
                  onDelete={() => deleteItem(item.id)}
                  onLongPress={() => setEditingItemId(item.id)}
                  editingItemId={editingItemId}
                  onEditSubmit={saveInlineEdit}
                  isFirst={index === 0}
                  tapToEdit={isTips}
                  onAddPhoto={() => addPhotoToItem(item.id)}
                  onViewImage={setImageViewUrl}
                />
              );

            }}
          />
          </View>
          </View>
        )}

        <View style={[styles.addRow, { backgroundColor: colors.offWhite, borderTopColor: colors.gray100, paddingBottom: insets.bottom > 0 ? insets.bottom : 14, flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
          {isGroceryList && (
            <TouchableOpacity onPress={() => setRecipeModalVisible(true)} style={[styles.recipeImportBtn, { backgroundColor: colors.gray100 }]} activeOpacity={0.7}>
              <Text style={{ fontSize: 20 }}>🍽️</Text>
            </TouchableOpacity>
          )}
          <View style={[styles.addPill, { backgroundColor: colors.gray100, flex: 1 }]}>
            <TextInput
              style={[styles.addInput, { color: colors.black }]}
              value={newItemText}
              onChangeText={setNewItemText}
              placeholder="Item toevoegen..."
              placeholderTextColor={colors.gray400}
              returnKeyType="done"
              onSubmitEditing={addItem}
              autoFocus={!loading && items.length === 0}
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

        <Modal visible={recipeModalVisible} transparent animationType="fade" onRequestClose={closeRecipeModal} statusBarTranslucent>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <View style={styles.recipeModalOverlay}>
            <View style={[styles.recipeModal, { backgroundColor: colors.white }]}>
              <Text style={[styles.recipeModalTitle, { color: colors.black }]}>Recept importeren</Text>
              <Text style={[styles.recipeModalSub, { color: colors.gray400 }]}>
                Plak een link van een recept-website, TikTok of YouTube. Ingrediënten worden automatisch toegevoegd.
              </Text>

              {!recipeResult ? (
                <>
                  <View style={[styles.recipeUrlInput, { backgroundColor: colors.gray100 }]}>
                    <Ionicons name="link-outline" size={18} color={colors.gray400} style={{ marginRight: 8 }} />
                    <TextInput
                      style={[styles.recipeUrlField, { color: colors.black }]}
                      value={recipeUrl}
                      onChangeText={setRecipeUrl}
                      placeholder="https://..."
                      placeholderTextColor={colors.gray400}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                      returnKeyType="go"
                      onSubmitEditing={importRecipeFromApp}
                      selectionColor={Colors.yellow}
                    />
                    {recipeUrl.length > 0 && (
                      <TouchableOpacity onPress={() => setRecipeUrl('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                        <Ionicons name="close-circle" size={18} color={colors.gray400} />
                      </TouchableOpacity>
                    )}
                  </View>

                  <View style={[styles.servingsRow, { backgroundColor: colors.gray100 }]}>
                    <Text style={[styles.servingsLabel, { color: colors.black }]}>Aantal personen</Text>
                    <View style={styles.servingsStepper}>
                      <TouchableOpacity
                        onPress={() => setRecipeServings(p => p && p > 1 ? p - 1 : null)}
                        style={[styles.stepperBtn, { backgroundColor: colors.white }]}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="remove" size={16} color={colors.black} />
                      </TouchableOpacity>
                      <Text style={[styles.stepperVal, { color: colors.black }]}>
                        {recipeServings ?? '—'}
                      </Text>
                      <TouchableOpacity
                        onPress={() => setRecipeServings(p => (p ?? 1) + 1)}
                        style={[styles.stepperBtn, { backgroundColor: colors.white }]}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="add" size={16} color={colors.black} />
                      </TouchableOpacity>
                    </View>
                  </View>

                  {recipeError && (
                    <View style={styles.recipeErrorBox}>
                      <Ionicons name="warning-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
                      <Text style={styles.recipeErrorText}>{recipeError}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.recipeImportAction, (!recipeUrl.trim() || recipeImporting) && { opacity: 0.5 }]}
                    onPress={importRecipeFromApp}
                    disabled={!recipeUrl.trim() || recipeImporting}
                    activeOpacity={0.85}
                  >
                    <LinearGradient colors={['#FCC10C', '#E5A800']} style={styles.recipeImportGrad}>
                      {recipeImporting
                        ? <ActivityIndicator size="small" color={Colors.black} />
                        : <Text style={styles.recipeImportBtnText}>Importeren</Text>}
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : (
                <View style={styles.recipeResultBox}>
                  <Text style={styles.recipeResultEmoji}>✅</Text>
                  <Text style={[styles.recipeResultTitle, { color: colors.black }]}>{recipeResult.title}</Text>
                  <Text style={[styles.recipeResultSub, { color: colors.gray400 }]}>
                    {recipeResult.added.length} ingrediënt{recipeResult.added.length !== 1 ? 'en' : ''} toegevoegd aan {recipeResult.listEmoji} {recipeResult.listName}
                    {recipeResult.merged.length > 0 ? `, ${recipeResult.merged.length} al aanwezig` : ''}
                  </Text>
                </View>
              )}

              <TouchableOpacity style={styles.recipeCloseBtn} onPress={closeRecipeModal} activeOpacity={0.7}>
                <Text style={[styles.recipeCloseBtnText, { color: colors.gray400 }]}>
                  {recipeResult ? 'Sluiten' : 'Annuleren'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          </KeyboardAvoidingView>
        </Modal>

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

        <Modal visible={!!imageViewUrl} transparent animationType="fade" onRequestClose={() => setImageViewUrl(null)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setImageViewUrl(null)}>
            {imageViewUrl && <Image source={{ uri: imageViewUrl }} style={{ width: '95%', height: '70%' }} resizeMode="contain" />}
          </Pressable>
        </Modal>

        <Modal visible={inviteModalVisible} transparent animationType="slide" onRequestClose={() => setInviteModalVisible(false)}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={() => setInviteModalVisible(false)}>
            <Pressable style={{ backgroundColor: colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40, gap: 16 }} onPress={() => {}}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 20, color: colors.black }}>
                Chefje toevoegen 👨‍🍳
              </Text>
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, lineHeight: 20 }}>
                Stuur de link hieronder. Als ze de app hebben, opent de lijst automatisch en worden ze meteen toegevoegd.
              </Text>

              {inviteUrlLoading ? (
                <View style={{ paddingVertical: 24, alignItems: 'center' }}>
                  <ActivityIndicator color={Colors.yellow} />
                </View>
              ) : inviteError ? (
                <View style={{ alignItems: 'center', gap: 12, paddingVertical: 8 }}>
                  <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: '#EF4444', textAlign: 'center' }}>Kon geen uitnodigingslink genereren.</Text>
                  <TouchableOpacity onPress={openInviteModal} style={{ paddingHorizontal: 20, paddingVertical: 10, backgroundColor: Colors.yellow, borderRadius: 20 }} activeOpacity={0.8}>
                    <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.black }}>Opnieuw proberen</Text>
                  </TouchableOpacity>
                </View>
              ) : inviteUrl ? (
                <>
                  {/* Link preview */}
                  <View style={{ backgroundColor: colors.gray100, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <Ionicons name="link-outline" size={16} color={colors.gray400} />
                    <Text style={{ flex: 1, fontFamily: 'Inter_400Regular', fontSize: 13, color: colors.gray400 }} numberOfLines={1}>{inviteUrl}</Text>
                  </View>

                  {/* Actions */}
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={async () => {
                        await import('expo-clipboard').then(C => C.setStringAsync(inviteUrl));
                        showToast('Link gekopieerd!', 'success');
                      }}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, paddingVertical: 15, borderWidth: 1.5, borderColor: Colors.yellow }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="copy-outline" size={17} color={Colors.yellow} />
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.yellow }}>Kopieer link</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        const msg = `Hey! Ik wil de lijst "${emoji ?? '📝'} ${name}" met je delen in De Sous-Chef 🍳\n\nKlik op de link om meteen toe te voegen:\n${inviteUrl}`;
                        Linking.openURL(`whatsapp://send?text=${encodeURIComponent(msg)}`).catch(() =>
                          Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`)
                        );
                      }}
                      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, paddingVertical: 15, backgroundColor: '#25D366' }}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="logo-whatsapp" size={17} color="#fff" />
                      <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' }}>WhatsApp</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={{ fontFamily: 'Inter_300Light', fontSize: 12, color: colors.gray400, textAlign: 'center' }}>
                    Link is 7 dagen geldig
                  </Text>
                </>
              ) : null}
            </Pressable>
          </Pressable>
        </Modal>
      </View>
      </KeyboardAvoidingView>
    </View>
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
  list: { paddingHorizontal: 10, paddingTop: 16, paddingBottom: 32 },
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
    borderRadius: 0, paddingHorizontal: 16, paddingVertical: 16,
    minHeight: 60,
  },
  itemCheckedContainer: { opacity: 0.6 },
  checkbox: {
    width: 26, height: 26, borderRadius: 13, borderWidth: 2,
    borderColor: Colors.gray200, marginRight: 14,
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxDone: { backgroundColor: Colors.yellow, borderColor: Colors.yellow },
  itemText: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 16, color: Colors.black },
  itemTextDone: { textDecorationLine: 'line-through', color: Colors.gray400, fontFamily: 'Inter_300Light' },
  checkAction: {
    backgroundColor: '#5A8A5A', borderRadius: 0, width: 72,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8, marginRight: 4,
  },
  deleteAction: {
    backgroundColor: '#C0392B', borderRadius: 0, width: 72,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8,
  },
  editAction: {
    backgroundColor: '#4A90D8', borderRadius: 0, width: 72,
    justifyContent: 'center', alignItems: 'center', marginBottom: 8, marginRight: 4,
  },
  itemCard: { flex: 1, marginHorizontal: 16, marginTop: 16, marginBottom: 10, borderRadius: Radius.lg, overflow: 'hidden', ...Shadow.card },
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
  doneSectionLabel: {
    fontFamily: 'Inter_700Bold', fontSize: 13,
    color: Colors.gray400, letterSpacing: 0.2,
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
  recipeImportBtn: {
    width: 52, height: 52, borderRadius: Radius.pill,
    justifyContent: 'center', alignItems: 'center',
  },
  recipeModalOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center', paddingHorizontal: 24,
  },
  recipeModal: {
    borderRadius: 24,
    padding: 24, paddingBottom: 28, gap: 14,
  },
  recipeModalTitle: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  recipeModalSub: { fontFamily: 'Inter_300Light', fontSize: 14, lineHeight: 21 },
  recipeUrlInput: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 12,
  },
  recipeUrlField: {
    flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, padding: 0,
  },
  recipeErrorBox: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FEE2E2', borderRadius: Radius.md, padding: 12,
  },
  recipeErrorText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#EF4444', flex: 1 },
  recipeImportAction: { marginTop: 4 },
  recipeImportGrad: {
    borderRadius: Radius.pill, paddingVertical: 16, alignItems: 'center',
  },
  recipeImportBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: Colors.black },
  recipeResultBox: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  recipeResultEmoji: { fontSize: 40 },
  recipeResultTitle: { fontFamily: 'Inter_700Bold', fontSize: 18, textAlign: 'center' },
  recipeResultSub: { fontFamily: 'Inter_300Light', fontSize: 14, textAlign: 'center', lineHeight: 21 },
  recipeCloseBtn: { alignItems: 'center', paddingVertical: 8 },
  recipeCloseBtnText: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  servingsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: Radius.md, paddingHorizontal: 14, paddingVertical: 10,
  },
  servingsLabel: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  servingsStepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperBtn: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  stepperVal: { fontFamily: 'Inter_600SemiBold', fontSize: 16, minWidth: 24, textAlign: 'center' },
  recipeGroupHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, marginTop: 16,
  },
  recipeGroupTitle: {
    fontFamily: 'Inter_600SemiBold', fontSize: 12,
    textTransform: 'uppercase', letterSpacing: 0.8, flex: 1, marginRight: 8,
  },
});
