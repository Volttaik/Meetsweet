import React, { useState } from 'react';
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pencil, Plus, Search } from 'lucide-react-native';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsEmptyState } from '@/components/MsEmptyState';

const MSG_TABS = ['All', 'Requests', 'Archived'] as const;
type MsgTab = typeof MSG_TABS[number];

const CONVERSATIONS = [
  { id: 1, initials: 'AR', name: 'Alex Rivera',  lastMsg: 'That sounds amazing! 🔥',     time: '2m',  unread: 2, online: true  },
  { id: 2, initials: 'SM', name: 'Sarah Moon',   lastMsg: 'Let me check my schedule...',  time: '8m',  unread: 0, online: false },
  { id: 3, initials: 'DS', name: 'Dev Studio',   lastMsg: 'Thanks for the feedback!',     time: '1h',  unread: 1, online: true  },
  { id: 4, initials: 'CX', name: 'Creative X',   lastMsg: 'See you tomorrow 👋',          time: '3h',  unread: 0, online: false },
  { id: 5, initials: 'LK', name: 'Luna Kim',     lastMsg: 'Just sent you the files',      time: '6h',  unread: 0, online: true  },
  { id: 6, initials: 'JT', name: 'Jay Torres',   lastMsg: 'Great collaboration!',         time: '1d',  unread: 0, online: false },
];

type Conversation = typeof CONVERSATIONS[0];

function ConversationRow({ item }: { item: Conversation }) {
  const isUnread = item.unread > 0;
  return (
    <TouchableOpacity style={styles.convoRow} activeOpacity={0.7}>
      <MsAvatar size={50} initials={item.initials} showOnline={item.online} />
      <View style={styles.convoContent}>
        <Text style={[styles.convoName, isUnread && styles.bold]} numberOfLines={1}>{item.name}</Text>
        <Text style={[styles.convoMsg, isUnread && styles.convoMsgUnread]} numberOfLines={1}>{item.lastMsg}</Text>
      </View>
      <View style={styles.convoRight}>
        <Text style={styles.convoTime}>{item.time}</Text>
        {isUnread ? (
          <View style={styles.unreadBadge}>
            <Text style={styles.unreadText}>{item.unread}</Text>
          </View>
        ) : (
          <View style={{ width: 18 }} />
        )}
      </View>
    </TouchableOpacity>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<MsgTab>('All');

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Messages</Text>
        <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
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
          editable={false}
        />
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
              <Text style={[styles.tabChipLabel, isActive && styles.tabChipLabelActive]}>{tab}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* List or empty state */}
      {activeTab === 'All' ? (
        <FlatList
          data={CONVERSATIONS}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <ConversationRow item={item} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 80 }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      ) : (
        <MsEmptyState
          emoji="💬"
          title={activeTab === 'Requests' ? 'No message requests' : 'Nothing archived yet'}
          message="When you receive requests or archive conversations, they'll appear here."
        />
      )}

      {/* FAB */}
      <TouchableOpacity style={styles.fab} activeOpacity={0.85}>
        <Plus size={22} color="#000000" strokeWidth={2.5} />
      </TouchableOpacity>
    </View>
  );
}

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
    borderRadius: T.RADIUS.md,
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
    borderWidth: 1,
    borderColor: T.BORDER_2,
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
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
  },
  tabChipActive: { backgroundColor: T.TEXT, borderColor: T.TEXT },
  tabChipLabel: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT_2 },
  tabChipLabelActive: { color: T.BG },

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
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
