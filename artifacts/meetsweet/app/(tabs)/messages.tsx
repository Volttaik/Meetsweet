import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, Plus, Search, X } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsEmptyState } from '@/components/MsEmptyState';
import {
  getConversations,
  searchUsers,
  createConversation,
  type Conversation,
  type ConversationUser,
} from '@/services/messages';

// ─── Constants ────────────────────────────────────────────────────────────────

const MSG_TABS = ['All', 'Archived'] as const;
type MsgTab = typeof MSG_TABS[number];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

// ─── Conversation row ─────────────────────────────────────────────────────────

function ConversationRow({ item }: { item: Conversation }) {
  const isUnread = item.unreadCount > 0;
  return (
    <TouchableOpacity
      style={styles.convoRow}
      activeOpacity={0.7}
      onPress={() => router.push(`/chat/${item.id}`)}
    >
      <MsAvatar size={50} initials={initials(item.otherUser.name)} />
      <View style={styles.convoContent}>
        <Text style={[styles.convoName, isUnread && styles.bold]} numberOfLines={1}>
          {item.otherUser.name}
        </Text>
        <Text
          style={[styles.convoMsg, isUnread && styles.convoMsgUnread]}
          numberOfLines={1}
        >
          {item.lastMessageBody ?? 'Say hello'}
        </Text>
      </View>
      <View style={styles.convoRight}>
        <Text style={styles.convoTime}>{formatTime(item.lastMessageAt)}</Text>
        {isUnread ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>
              {item.unreadCount > 9 ? '9+' : item.unreadCount}
            </Text>
          </View>
        ) : (
          <View style={{ width: 18 }} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ─── New message modal ────────────────────────────────────────────────────────

function NewMessageModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ConversationUser[]>([]);
  const [searching, setSearching] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleSearch = (text: string) => {
    setQ(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await searchUsers(text.trim());
        setResults(data.users);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  };

  const handleSelect = async (user: ConversationUser) => {
    try {
      const { conversationId } = await createConversation(user.id);
      onClose();
      setQ('');
      setResults([]);
      router.push(`/chat/${conversationId}`);
    } catch {}
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.modalBg}>
        <View style={styles.modalHeader}>
          <Text style={styles.modalTitle}>New Message</Text>
          <TouchableOpacity onPress={onClose} style={styles.modalClose} activeOpacity={0.7}>
            <X size={20} color={T.TEXT} strokeWidth={2} />
          </TouchableOpacity>
        </View>
        <View style={styles.modalSearch}>
          <Search size={15} color={T.TEXT_2} strokeWidth={1.8} />
          <TextInput
            placeholder="Search by name or username…"
            placeholderTextColor={T.TEXT_3}
            style={styles.modalSearchInput}
            value={q}
            onChangeText={handleSearch}
            autoFocus
          />
        </View>
        {searching ? (
          <View style={{ marginTop: 40, alignItems: 'center' }}>
            <Spinner size="lg" color="default" />
          </View>
        ) : results.length > 0 ? (
          <FlatList
            data={results}
            keyExtractor={(u) => u.id}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.userRow}
                activeOpacity={0.7}
                onPress={() => handleSelect(item)}
              >
                <MsAvatar size={42} initials={initials(item.name)} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.userName}>{item.name}</Text>
                  <Text style={styles.userHandle}>@{item.username}</Text>
                </View>
              </TouchableOpacity>
            )}
          />
        ) : q.length >= 2 ? (
          <MsEmptyState title="No users found" message={`No one matches "${q}"`} />
        ) : (
          <Text style={styles.modalHint}>Type at least 2 characters to search</Text>
        )}
      </View>
    </Modal>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<MsgTab>('All');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [searchText, setSearchText] = useState('');

  const load = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    try {
      const tab = activeTab === 'Archived' ? 'archived' : 'all';
      const data = await getConversations(tab);
      setConversations(data.conversations);
    } catch {
      // keep existing list
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activeTab]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [activeTab]);

  const filtered = searchText.trim()
    ? conversations.filter(
        (c) =>
          c.otherUser.name.toLowerCase().includes(searchText.toLowerCase()) ||
          c.otherUser.username.toLowerCase().includes(searchText.toLowerCase()),
      )
    : conversations;

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <TouchableOpacity
          style={styles.iconBtn}
          activeOpacity={0.7}
          onPress={() => setShowNewMsg(true)}
        >
          <Pencil size={18} color={T.TEXT} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <Search size={15} color={T.TEXT_2} strokeWidth={1.8} />
        <TextInput
          placeholder="Search conversations…"
          placeholderTextColor={T.TEXT_3}
          style={styles.searchInput}
          value={searchText}
          onChangeText={setSearchText}
        />
        {searchText.length > 0 && (
          <TouchableOpacity onPress={() => setSearchText('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <X size={14} color={T.TEXT_3} strokeWidth={2} />
          </TouchableOpacity>
        )}
      </View>

      {/* Tabs */}
      <View style={styles.tabRow}>
        {MSG_TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <TouchableOpacity
              key={tab}
              style={[styles.tabChip, isActive && styles.tabChipActive]}
              onPress={() => setActiveTab(tab)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabChipLabel, isActive && styles.tabChipLabelActive]}>
                {tab}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content */}
      {loading ? (
        <View style={styles.loadingWrap}>
          <Spinner size="lg" color="default" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ConversationRow item={item} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onRefresh={() => load(true)}
          refreshing={refreshing}
          ListEmptyComponent={
            <MsEmptyState
              title={
                activeTab === 'Archived'
                  ? 'No archived conversations'
                  : searchText
                  ? 'No results'
                  : 'No messages yet'
              }
              message={
                activeTab === 'Archived'
                  ? 'Archived chats will appear here.'
                  : searchText
                  ? `No conversations matching "${searchText}".`
                  : 'Tap the pencil icon to start a conversation.'
              }
            />
          }
        />
      )}

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => setShowNewMsg(true)}
      >
        <Plus size={22} color="#000000" strokeWidth={2.5} />
      </TouchableOpacity>

      <NewMessageModal visible={showNewMsg} onClose={() => setShowNewMsg(false)} />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: T.BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  title: { fontSize: 20, fontFamily: T.FONT.bold, color: T.TEXT, letterSpacing: -0.4 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 12,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.md,
    borderWidth: 0,
    paddingHorizontal: 14,
    height: 42,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
    height: '100%',
    backgroundColor: 'transparent',
  },

  tabRow: { flexDirection: 'row', paddingHorizontal: 20, gap: 8, marginBottom: 8 },
  tabChip: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.SURFACE,
  },
  tabChipActive: { backgroundColor: T.TEXT, borderColor: T.TEXT },
  tabChipLabel: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT_2 },
  tabChipLabelActive: { color: T.BG },

  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  convoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12,
  },
  convoContent: { flex: 1 },
  convoName: { fontSize: 15, fontFamily: T.FONT.medium, color: T.TEXT, marginBottom: 3 },
  bold: { fontFamily: T.FONT.bold },
  convoMsg: { fontSize: 13, fontFamily: T.FONT.regular, color: T.TEXT_2 },
  convoMsgUnread: { color: T.TEXT, fontFamily: T.FONT.medium },
  convoRight: { alignItems: 'flex-end', gap: 6 },
  convoTime: { fontSize: 12, fontFamily: T.FONT.regular, color: T.TEXT_3 },
  unreadBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  unreadText: { fontSize: 10, fontFamily: T.FONT.bold, color: T.BG },
  separator: { height: 1, backgroundColor: T.BORDER, marginLeft: 82 },

  fab: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },

  // New message modal
  modalBg: { flex: 1, backgroundColor: T.BG },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  modalTitle: { fontSize: 18, fontFamily: T.FONT.bold, color: T.TEXT },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginVertical: 12,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    paddingHorizontal: 14,
    height: 44,
    gap: 10,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
    height: '100%',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  userName: { fontSize: 14, fontFamily: T.FONT.semibold, color: T.TEXT },
  userHandle: { fontSize: 12, fontFamily: T.FONT.regular, color: T.TEXT_2, marginTop: 2 },
  modalHint: {
    textAlign: 'center',
    marginTop: 40,
    fontSize: 13,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
  },
});
