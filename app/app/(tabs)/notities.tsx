import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  TextInput,
  Modal,
  ScrollView,
  Animated,
  Pressable,
  Platform,
  Share,
  KeyboardAvoidingView,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { SwipeDeleteRow } from '@/components/SwipeDeleteRow';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { supabase } from '@/lib/supabase';
import { useUser } from '@/context/UserContext';
import { Note } from '@/lib/types';
import { getCache, setCache } from '@/lib/cache';
import { Colors, Radius, Shadow } from '@/constants/Design';
import { useTheme } from '@/context/ThemeContext';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'https://sous-chef-pckg.onrender.com';

const todayStr = new Date().toISOString().split('T')[0];
const yesterdayStr = (() => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
})();

function noteDateKey(iso: string): string {
  return iso.split('T')[0];
}

function sectionTitle(dateKey: string): string {
  if (dateKey === todayStr) return 'Vandaag';
  if (dateKey === yesterdayStr) return 'Gisteren';
  const d = new Date(dateKey + 'T00:00:00');
  return d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long' });
}

function groupNotes(notes: Note[]): { title: string; data: Note[] }[] {
  const map = new Map<string, Note[]>();
  for (const note of notes) {
    const key = noteDateKey(note.created_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(note);
  }
  return Array.from(map.entries()).map(([key, data]) => ({
    title: sectionTitle(key),
    data,
  }));
}

function InlineMd({ text, style, numberOfLines }: { text: string; style?: any; numberOfLines?: number }) {
  const parts: { t: string; bold: boolean }[] = [];
  const regex = /\*\*(.*?)\*\*/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > last) parts.push({ t: text.slice(last, m.index), bold: false });
    parts.push({ t: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: text.slice(last), bold: false });
  return (
    <Text style={style} numberOfLines={numberOfLines}>
      {parts.map((p, i) =>
        p.bold
          ? <Text key={i} style={{ fontFamily: 'Inter_700Bold' }}>{p.t}</Text>
          : <Text key={i}>{p.t}</Text>
      )}
    </Text>
  );
}

function stripMd(text: string): string {
  return text.replace(/\*\*(.*?)\*\*/g, '$1');
}

function getCardStyles(isDark: boolean) {
  return [
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: Colors.black, title: Colors.yellow, body: '#888', date: '#444' },
    { bg: isDark ? '#2C2C2E' : Colors.white, title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
    { bg: isDark ? '#242426' : '#F5F5F0', title: isDark ? Colors.white : Colors.black, body: isDark ? '#AEAEB2' : Colors.gray600, date: isDark ? '#3A3A3C' : Colors.gray200 },
  ];
}

function BreathingEmoji({ size = 40 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1.0,  duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, []);
  return (
    <Animated.View style={{ transform: [{ scale: pulse }] }}>
      <Ionicons name="document-text-outline" size={size} color={Colors.gray400} />
    </Animated.View>
  );
}

function NoteCard({
  item,
  index,
  onPress,
  onDelete,
  isShared,
}: {
  item: Note;
  index: number;
  onPress: () => void;
  onDelete: () => void;
  isShared?: boolean;
}) {
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
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 10 }}>
      <SwipeDeleteRow onDelete={onDelete} borderRadius={Radius.lg}>
        <Pressable
          onPress={onPress}
          onPressIn={() => Animated.spring(scale, { toValue: 0.97, useNativeDriver: true, speed: 50 }).start()}
          onPressOut={() => Animated.spring(scale, { toValue: 1,    useNativeDriver: true, speed: 50 }).start()}
        >
          <Animated.View style={[styles.card, { backgroundColor: style.bg, transform: [{ scale }] }]}>
            {isShared && (
              <View pointerEvents="none" style={{ position: 'absolute', top: 6, left: 6, zIndex: 1 }}>
                <Text style={{ fontSize: 11 }}>👥</Text>
              </View>
            )}
            <Text style={[styles.cardTitle, { color: style.title }]} numberOfLines={2}>
              {item.title ? stripMd(item.title) : stripMd(item.body.slice(0, 40))}
            </Text>
            <InlineMd text={item.body} style={[styles.cardBody, { color: style.body }]} numberOfLines={5} />
            <View style={styles.cardFooter}>
              <Text style={[styles.cardDate, { color: style.date }]}>
                {item.updated_at && item.updated_at !== item.created_at ? `Bijgewerkt ${formatDate(item.updated_at)}` : `Aangemaakt ${formatDate(item.created_at)}`}
              </Text>
              <Ionicons name="open-outline" size={12} color={style.date} />
            </View>
          </Animated.View>
        </Pressable>
      </SwipeDeleteRow>
    </Animated.View>
  );
}

function UndoSnackbar({ visible, onUndo }: { visible: boolean; onUndo: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    }
  }, [visible]);

  return (
    <Animated.View style={[styles.snackbar, { opacity }]} pointerEvents={visible ? 'auto' : 'none'}>
      <Text style={styles.snackbarText}>Notitie verwijderd</Text>
      <TouchableOpacity onPress={onUndo} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Text style={styles.snackbarUndo}>Ongedaan</Text>
      </TouchableOpacity>
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
  const [deletedNote, setDeletedNote] = useState<Note | null>(null);
  const [snackbarVisible, setSnackbarVisible] = useState(false);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [editBody, setEditBody] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [sharedNoteIds, setSharedNoteIds] = useState<Set<string>>(new Set());
  const [noteInviteVisible, setNoteInviteVisible] = useState(false);
  const [noteInviteTarget, setNoteInviteTarget] = useState<Note | null>(null);
  const [noteInvitePhone, setNoteInvitePhone] = useState('');
  const [noteInviteError, setNoteInviteError] = useState('');
  const [noteInviting, setNoteInviting] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageViewUrl, setImageViewUrl] = useState<string | null>(null);
  const [addNoteVisible, setAddNoteVisible] = useState(false);
  const [addNoteTitle, setAddNoteTitle] = useState('');
  const [addNoteBody, setAddNoteBody] = useState('');
  const [addNoteSaving, setAddNoteSaving] = useState(false);

  const fetchNotes = useCallback(async () => {
    if (!user || user.id === 'dev') { setLoading(false); setRefreshing(false); return; }
    const [notesRes, sharedNoteRes] = await Promise.all([
      supabase.from('notes').select('id, user_id, title, body, created_at, updated_at, image_url').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('note_members').select('note_id').eq('user_id', user.id),
    ]);
    if (notesRes.data) { setNotes(notesRes.data); setCache('cache_notes', notesRes.data); }
    setSharedNoteIds(new Set((sharedNoteRes.data ?? []).map((r: any) => r.note_id)));
    setLoading(false);
    setRefreshing(false);
  }, [user]);

  useEffect(() => {
    getCache<Note[]>('cache_notes').then(d => {
      if (d) { setNotes(d); setLoading(false); }
    });
  }, []);

  useEffect(() => {
    fetchNotes();
    if (!user || user.id === 'dev') return;
    const channel = supabase.channel('notes-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notes', filter: `user_id=eq.${user.id}` }, fetchNotes)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, fetchNotes]);

  async function sendNoteInvite() {
    if (!noteInvitePhone.trim() || !noteInviteTarget || !user) return;
    setNoteInviting(true);
    setNoteInviteError('');
    try {
      const res = await fetch(`${API_BASE}/sharing/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'note', resource_id: noteInviteTarget.id, phone: noteInvitePhone.trim(), user_id: user.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        setNoteInviteError(json.error ?? 'Er ging iets mis.');
      } else {
        setNoteInviteVisible(false);
        setNoteInviteTarget(null);
      }
    } catch {
      setNoteInviteError('Geen verbinding. Probeer het opnieuw.');
    } finally {
      setNoteInviting(false);
    }
  }

  function handleDelete(note: Note) {
    setNotes(prev => prev.filter(n => n.id !== note.id));
    setDeletedNote(note);
    setSnackbarVisible(true);

    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    undoTimeoutRef.current = setTimeout(async () => {
      setSnackbarVisible(false);
      setDeletedNote(prev => {
        if (prev?.id === note.id) {
          fetch(`${API_BASE}/notes/${note.id}?user_id=${user!.id}`, { method: 'DELETE' }).catch(() => {});
          return null;
        }
        return prev;
      });
    }, 3000);
  }

  function handleUndo() {
    if (!deletedNote) return;
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    setNotes(prev => {
      const exists = prev.some(n => n.id === deletedNote.id);
      if (exists) return prev;
      return [deletedNote, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at));
    });
    setDeletedNote(null);
    setSnackbarVisible(false);
  }

  async function addPhotoToNote(note: typeof selected) {
    if (!note || !user || uploadingImage) return;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      exif: false,
    });
    if (result.canceled || !result.assets[0]?.base64) return;
    setUploadingImage(true);
    try {
      const asset = result.assets[0];
      const mimeType = asset.mimeType ?? 'image/jpeg';
      const res = await fetch(`${API_BASE}/notes/${note.id}/image?user_id=${user.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base64: asset.base64, mime_type: mimeType }),
      }).catch(() => null);
      const data = res ? await res.json().catch(() => null) : null;
      if (data?.image_url) {
        setNotes(prev => prev.map(n => n.id === note.id ? { ...n, image_url: data.image_url } : n));
        setSelected(prev => prev ? { ...prev, image_url: data.image_url } : null);
      } else {
        Alert.alert('Upload mislukt', 'Probeer het opnieuw.');
      }
    } catch {
      Alert.alert('Upload mislukt', 'Probeer het opnieuw.');
    } finally {
      setUploadingImage(false);
    }
  }

  const filtered = notes.filter(n =>
    n.title?.toLowerCase().includes(search.toLowerCase()) ||
    n.body.toLowerCase().includes(search.toLowerCase()),
  );

  const sections = groupNotes(filtered);

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
          <Ionicons name="search-outline" size={15} color={searchFocused ? Colors.yellow : 'rgba(255,255,255,0.4)'} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Zoeken in notities..."
            placeholderTextColor="rgba(255,255,255,0.3)"
            selectionColor={Colors.yellow}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle-outline" size={16} color="rgba(255,255,255,0.4)" />
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
            <BreathingEmoji size={32} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.black }]}>{search ? 'Geen resultaten' : 'Geen notities'}</Text>
          {!search && (
            <Text style={[styles.emptyText, { color: colors.gray400 }]}>
              Stuur via WhatsApp:{'\n'}
              <Text style={styles.exampleMsg}>"onthoud: altijd water drinken voor de lunch"</Text>
            </Text>
          )}
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          style={{ backgroundColor: colors.offWhite }}
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchNotes(); }} tintColor={Colors.yellow} />}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.sectionHeader, { color: colors.gray400 }]}>
              {section.title.toUpperCase()}
            </Text>
          )}
          renderItem={({ item, index }) => (
            <NoteCard
              item={item}
              index={index}
              onPress={() => setSelected(item)}
              onDelete={() => handleDelete(item)}
              isShared={sharedNoteIds.has(item.id)}
            />
          )}
        />
      )}

      <UndoSnackbar visible={snackbarVisible} onUndo={handleUndo} />

      <Modal visible={!!imageViewUrl} transparent animationType="fade" onRequestClose={() => setImageViewUrl(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center', alignItems: 'center' }} onPress={() => setImageViewUrl(null)}>
          {imageViewUrl && <Image source={{ uri: imageViewUrl }} style={{ width: '95%', height: '70%' }} resizeMode="contain" />}
        </Pressable>
      </Modal>

      <Modal visible={noteInviteVisible} transparent animationType="slide" onRequestClose={() => setNoteInviteVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={() => setNoteInviteVisible(false)}>
            <Pressable style={{ backgroundColor: colors.white, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 40 }}>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 18, color: colors.black, marginBottom: 6 }}>Chefje toevoegen 👨‍🍳</Text>
              <Text style={{ fontFamily: 'Inter_300Light', fontSize: 14, color: colors.gray400, marginBottom: 16 }}>Voer het WhatsApp-nummer in van de persoon die je toegang wilt geven.</Text>
              <TextInput
                value={noteInvitePhone}
                onChangeText={t => { setNoteInvitePhone(t); setNoteInviteError(''); }}
                placeholder="Voeg een chefje toe"
                keyboardType="phone-pad"
                style={{ borderWidth: 1, borderColor: noteInviteError ? '#EF4444' : colors.gray100, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'Inter_400Regular', fontSize: 15, color: colors.black, marginBottom: 8 }}
                autoFocus
              />
              {!!noteInviteError && <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 13, color: '#EF4444', marginBottom: 8 }}>{noteInviteError}</Text>}
              <TouchableOpacity
                onPress={sendNoteInvite}
                disabled={noteInviting || !noteInvitePhone.trim()}
                style={{ backgroundColor: noteInviting || !noteInvitePhone.trim() ? colors.gray100 : Colors.yellow, borderRadius: 12, paddingVertical: 14, alignItems: 'center' }}
                activeOpacity={0.85}
              >
                {noteInviting ? <ActivityIndicator size="small" color={Colors.black} /> : <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 15, color: Colors.black }}>Uitnodiging sturen</Text>}
              </TouchableOpacity>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!selected} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => { setSelected(null); setEditMode(false); }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
          <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
              <TouchableOpacity onPress={() => { setSelected(null); setEditMode(false); }} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
                <Ionicons name="close" size={18} color={colors.black} />
              </TouchableOpacity>
              <Text style={[styles.modalDateHeader, { color: colors.gray400 }]}>
                {selected ? (selected.updated_at && selected.updated_at !== selected.created_at ? `Bijgewerkt ${formatDate(selected.updated_at)}` : `Aangemaakt ${formatDate(selected.created_at)}`) : ''}
              </Text>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity
                  onPress={() => selected && Share.share({ message: `${selected.title ? selected.title + '\n\n' : ''}${selected.body}`, title: selected.title || 'Notitie' })}
                  style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
                >
                  <Ionicons name="share-outline" size={17} color={colors.black} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => addPhotoToNote(selected)}
                  disabled={uploadingImage}
                  style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}
                >
                  {uploadingImage
                    ? <ActivityIndicator size="small" color={colors.black} />
                    : <Ionicons name="camera-outline" size={17} color={colors.black} />
                  }
                </TouchableOpacity>
                {editMode ? (
                  <TouchableOpacity
                    onPress={async () => {
                      if (!selected || !editBody.trim() || editSaving) return;
                      setEditSaving(true);
                      const updatedAt = new Date().toISOString();
                      await supabase.from('notes').update({ body: editBody.trim(), updated_at: updatedAt }).eq('id', selected.id);
                      setNotes(prev => prev.map(n => n.id === selected.id ? { ...n, body: editBody.trim(), updated_at: updatedAt } : n));
                      setSelected(prev => prev ? { ...prev, body: editBody.trim(), updated_at: updatedAt } : null);
                      setEditMode(false);
                      setEditSaving(false);
                    }}
                    style={[styles.closeBtn, { backgroundColor: Colors.yellow }]}
                  >
                    <Ionicons name="checkmark" size={18} color={Colors.black} />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={() => { setEditBody(selected?.body ?? ''); setEditMode(true); }} style={[styles.closeBtn, { backgroundColor: colors.gray100 }]}>
                    <Ionicons name="pencil-outline" size={17} color={colors.black} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent} keyboardDismissMode="interactive">
              {selected?.title && <Text style={[styles.modalTitle, { color: colors.black }]}>{selected.title}</Text>}
              {editMode ? (
                <TextInput
                  style={[styles.modalBody, { color: colors.gray800, borderWidth: 1, borderColor: Colors.yellow + '60', borderRadius: Radius.md, padding: 12, textAlignVertical: 'top', minHeight: 200 }]}
                  value={editBody}
                  onChangeText={setEditBody}
                  multiline
                  autoFocus
                  selectionColor={Colors.yellow}
                />
              ) : (
                <InlineMd text={selected?.body ?? ''} style={[styles.modalBody, { color: colors.gray800 }]} />
              )}
              {selected?.image_url && (
                <TouchableOpacity onPress={() => setImageViewUrl(selected.image_url!)} activeOpacity={0.9} style={{ marginTop: 20 }}>
                  <Image source={{ uri: selected.image_url }} style={{ width: '100%', height: 220, borderRadius: Radius.lg }} resizeMode="cover" />
                </TouchableOpacity>
              )}
            </ScrollView>
            {!editMode && selected && (
              <TouchableOpacity
                onPress={() => { setNoteInviteTarget(selected); setNoteInvitePhone(''); setNoteInviteError(''); setNoteInviteVisible(true); }}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.gray100 }}
                activeOpacity={0.7}
              >
                <Ionicons name="person-add-outline" size={15} color={colors.gray400} />
                <Text style={{ fontFamily: 'Inter_400Regular', fontSize: 14, color: colors.gray400 }}>Chefje toevoegen</Text>
              </TouchableOpacity>
            )}
          </SafeAreaView>
        </KeyboardAvoidingView>
      </Modal>

      {/* FAB */}
      <TouchableOpacity
        onPress={() => { setAddNoteTitle(''); setAddNoteBody(''); setAddNoteVisible(true); }}
        style={{ position: 'absolute', right: 20, bottom: insets.bottom + 90, width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.yellow, justifyContent: 'center', alignItems: 'center', shadowColor: Colors.yellow, shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={26} color={Colors.black} />
      </TouchableOpacity>

      {/* Add note modal */}
      <Modal visible={addNoteVisible} animationType="slide" presentationStyle="formSheet" onRequestClose={() => setAddNoteVisible(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <SafeAreaView style={[styles.modal, { backgroundColor: colors.white }]}>
            <View style={[styles.modalHeader, { borderBottomColor: colors.gray100 }]}>
              <TouchableOpacity onPress={() => setAddNoteVisible(false)} style={styles.closeBtn}>
                <Ionicons name="close" size={18} color={colors.gray400} />
              </TouchableOpacity>
              <Text style={{ fontFamily: 'Inter_700Bold', fontSize: 17, color: colors.black }}>Nieuwe notitie</Text>
              <TouchableOpacity
                onPress={async () => {
                  if (!user || !addNoteBody.trim() || addNoteSaving) return;
                  setAddNoteSaving(true);
                  const res = await fetch(`${API_BASE}/notes?user_id=${user.id}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: addNoteTitle.trim() || null, body: addNoteBody.trim() }),
                  }).catch(() => null);
                  const data = res ? await res.json().catch(() => null) : null;
                  if (data?.id) {
                    const newNote: Note = { id: data.id, user_id: user.id, title: addNoteTitle.trim() || null, body: addNoteBody.trim(), created_at: new Date().toISOString() };
                    setNotes(prev => [newNote, ...prev]);
                  }
                  setAddNoteSaving(false);
                  setAddNoteVisible(false);
                }}
                disabled={!addNoteBody.trim() || addNoteSaving}
                style={[styles.closeBtn, { backgroundColor: Colors.yellow, opacity: addNoteBody.trim() ? 1 : 0.4 }]}
              >
                {addNoteSaving ? <ActivityIndicator size="small" color={Colors.black} /> : <Ionicons name="checkmark" size={18} color={Colors.black} />}
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled">
              <TextInput
                style={[styles.modalTitle, { color: colors.black }]}
                value={addNoteTitle}
                onChangeText={setAddNoteTitle}
                placeholder="Titel (optioneel)"
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
                returnKeyType="next"
                autoFocus
              />
              <TextInput
                style={[styles.modalBody, { color: colors.black, minHeight: 160 }]}
                value={addNoteBody}
                onChangeText={setAddNoteBody}
                placeholder="Schrijf hier je notitie..."
                placeholderTextColor={colors.gray400}
                selectionColor={Colors.yellow}
                multiline
                textAlignVertical="top"
              />
            </ScrollView>
          </SafeAreaView>
        </KeyboardAvoidingView>
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
  listContent: { padding: 20, paddingBottom: 120 },
  sectionHeader: {
    fontFamily: 'Inter_600SemiBold', fontSize: 10, letterSpacing: 1.2,
    marginBottom: 10, marginTop: 6,
  },
  card: { borderRadius: Radius.lg, padding: 16, minHeight: 130, ...Shadow.card },
  cardTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, marginBottom: 8, letterSpacing: -0.2 },
  cardBody: { fontFamily: 'Inter_300Light', fontSize: 13, lineHeight: 19, flex: 1 },
  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  cardDate: { fontFamily: 'Inter_300Light', fontSize: 11 },
  deleteAction: {
    backgroundColor: '#EF4444', justifyContent: 'center', alignItems: 'center',
    borderRadius: Radius.lg, width: 80, marginBottom: 10,
    gap: 4,
  },
  deleteActionText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: Colors.white },
  snackbar: {
    position: 'absolute', bottom: 24, left: 20, right: 20,
    backgroundColor: Colors.black, borderRadius: Radius.md,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    ...Shadow.card,
  },
  snackbarText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: Colors.white },
  snackbarUndo: { fontFamily: 'Inter_700Bold', fontSize: 14, color: Colors.yellow },
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
