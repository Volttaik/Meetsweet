import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Spinner } from 'heroui-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, PaperPlaneRight, DotsThree } from 'phosphor-react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { useAuth } from '@/contexts/AuthContext';
import {
  getMessages,
  sendMessage,
  deleteMessage,
  type ChatMessage,
} from '@/services/messages';
import { getConversations } from '@/services/messages';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function needsDateSeparator(curr: ChatMessage, prev: ChatMessage | undefined): boolean {
  if (!prev) return true;
  return new Date(curr.createdAt).toDateString() !== new Date(prev.createdAt).toDateString();
}

function initials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  message,
  onLongPress,
}: {
  message: ChatMessage;
  onLongPress?: () => void;
}) {
  const isOwn = message.isOwn;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onLongPress={onLongPress}
      style={[styles.bubbleWrap, isOwn ? styles.bubbleWrapOwn : styles.bubbleWrapOther]}
    >
      {!isOwn && (
        <MsAvatar
          size={28}
          initials={initials(message.sender.name)}
          imageUri={message.sender.avatarUrl ?? undefined}
        />
      )}
      <View style={{ maxWidth: '70%' }}>
        {message.isDeleted ? (
          <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther, styles.bubbleDeleted]}>
            <Text style={styles.bubbleDeletedText}>Message deleted</Text>
          </View>
        ) : (
          <>
            {message.mediaUrl && message.mediaType === 'image' && (
              <Image
                source={{ uri: message.mediaUrl }}
                style={[styles.bubbleImage, isOwn ? { borderTopRightRadius: 2 } : { borderTopLeftRadius: 2 }]}
                resizeMode="cover"
              />
            )}
            {(message.body) ? (
              <View style={[styles.bubble, isOwn ? styles.bubbleOwn : styles.bubbleOther]}>
                <Text style={[styles.bubbleText, isOwn ? styles.bubbleTextOwn : styles.bubbleTextOther]}>
                  {message.body}
                </Text>
              </View>
            ) : null}
          </>
        )}
        <Text style={[styles.bubbleTime, isOwn ? styles.bubbleTimeOwn : styles.bubbleTimeOther]}>
          {formatTime(message.createdAt)}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const flatRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [text, setText] = useState('');
  const [otherUserName, setOtherUserName] = useState('');
  const [otherUserAvatar, setOtherUserAvatar] = useState<string | null>(null);

  const loadMessages = useCallback(async (before?: string) => {
    try {
      const data = await getMessages(conversationId, before);
      if (before) {
        setMessages((prev) => [...data.messages, ...prev]);
      } else {
        setMessages(data.messages);
      }
      setHasMore(data.hasMore);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [conversationId]);

  // Load conversation info (other user's name)
  useEffect(() => {
    getConversations('all').then((data) => {
      const conv = data.conversations.find((c) => c.id === conversationId);
      if (conv) {
        setOtherUserName(conv.otherUser.name);
        setOtherUserAvatar(conv.otherUser.avatarUrl);
      }
    }).catch(() => {});
  }, [conversationId]);

  useEffect(() => {
    loadMessages();
  }, [conversationId]);

  const handleSend = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setText('');
    setSending(true);

    // Optimistic message
    const optimistic: ChatMessage = {
      id: `opt-${Date.now()}`,
      body,
      mediaUrl: null,
      mediaType: null,
      isDeleted: false,
      createdAt: new Date().toISOString(),
      sender: {
        id: user?.id ?? '',
        name: user?.name ?? '',
        username: user?.username ?? '',
        avatarUrl: user?.avatarUrl ?? null,
      },
      isOwn: true,
    };

    setMessages((prev) => [...prev, optimistic]);
    setTimeout(() => flatRef.current?.scrollToEnd({ animated: true }), 50);

    try {
      const { message } = await sendMessage(conversationId, body);
      setMessages((prev) =>
        prev.map((m) => (m.id === optimistic.id ? message : m)),
      );
    } catch {
      // Revert optimistic
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setText(body);
    } finally {
      setSending(false);
    }
  };

  const handleLongPress = (msg: ChatMessage) => {
    if (!msg.isOwn || msg.isDeleted) return;
    Alert.alert('Message', 'Delete this message?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMessage(msg.id);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msg.id ? { ...m, isDeleted: true, body: null } : m,
            ),
          );
        },
      },
    ]);
  };

  const handleLoadMore = () => {
    if (loadingMore || !hasMore || messages.length === 0) return;
    setLoadingMore(true);
    loadMessages(messages[0]?.createdAt);
  };

  const renderItem = ({ item, index }: { item: ChatMessage; index: number }) => {
    const prev = messages[index - 1];
    const showDate = needsDateSeparator(item, prev);
    return (
      <>
        {showDate && (
          <View style={styles.dateSep}>
            <View style={styles.dateSepLine} />
            <Text style={styles.dateSepText}>{formatDateLabel(item.createdAt)}</Text>
            <View style={styles.dateSepLine} />
          </View>
        )}
        <MessageBubble message={item} onLongPress={() => handleLongPress(item)} />
      </>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerBack}
          onPress={() => router.back()}
          activeOpacity={0.7}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <ArrowLeft size={20} color={T.TEXT} />
        </TouchableOpacity>
        <MsAvatar
          size={36}
          initials={initials(otherUserName || '?')}
          imageUri={otherUserAvatar ?? undefined}
        />
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>
            {otherUserName || 'Loading…'}
          </Text>
        </View>
        <TouchableOpacity style={styles.headerMore} activeOpacity={0.7}>
          <DotsThree size={20} color={T.TEXT_2} />
        </TouchableOpacity>
      </View>

      {/* Messages */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        {loading ? (
          <View style={styles.loadingWrap}>
            <Spinner size="lg" color="default" />
          </View>
        ) : (
          <FlatList
            ref={flatRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.messageList}
            onLayout={() => flatRef.current?.scrollToEnd({ animated: false })}
            onStartReachedThreshold={0.3}
            onStartReached={handleLoadMore}
            ListHeaderComponent={
              loadingMore ? (
                <View style={{ alignItems: 'center', marginVertical: 16 }}>
                  <Spinner size="sm" color="default" />
                </View>
              ) : null
            }
            ListEmptyComponent={
              <View style={styles.emptyChat}>
                <MsAvatar
                  size={64}
                  initials={initials(otherUserName || '?')}
                  imageUri={otherUserAvatar ?? undefined}
                />
                <Text style={styles.emptyChatName}>{otherUserName}</Text>
                <Text style={styles.emptyChatHint}>No messages yet. Say hello! 👋</Text>
              </View>
            }
          />
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TextInput
            style={styles.input}
            placeholder="Message…"
            placeholderTextColor={T.TEXT_3}
            value={text}
            onChangeText={setText}
            multiline
            maxLength={2000}
          />
          <TouchableOpacity
            style={[styles.sendBtn, (!text.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            activeOpacity={0.8}
            disabled={!text.trim() || sending}
          >
            {sending ? (
              <Spinner size="sm" color="default" />
            ) : (
              <PaperPlaneRight size={18} color={T.BG} />
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
    gap: 10,
  },
  headerBack: {
    width: 36,
    height: 36,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerInfo: { flex: 1 },
  headerName: { fontSize: 15, fontFamily: T.FONT.semibold, color: T.TEXT },
  headerMore: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  messageList: { paddingHorizontal: 16, paddingVertical: 12, flexGrow: 1 },

  bubbleWrap: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginVertical: 2,
  },
  bubbleWrapOwn: { justifyContent: 'flex-end' },
  bubbleWrapOther: { justifyContent: 'flex-start' },

  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: '100%',
  },
  bubbleOwn: {
    backgroundColor: T.TEXT,
    borderBottomRightRadius: 4,
  },
  bubbleOther: {
    backgroundColor: T.SURFACE,
    borderBottomLeftRadius: 4,
    borderWidth: 1,
    borderColor: T.BORDER,
  },
  bubbleDeleted: {
    backgroundColor: T.SURFACE_2,
    borderStyle: 'dashed',
  },
  bubbleDeletedText: {
    fontSize: 13,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    fontStyle: 'italic',
  },
  bubbleText: { fontSize: 15, lineHeight: 22, fontFamily: T.FONT.regular },
  bubbleTextOwn: { color: T.BG },
  bubbleTextOther: { color: T.TEXT },
  bubbleImage: {
    width: 200,
    height: 200,
    borderRadius: 18,
    marginBottom: 4,
  },
  bubbleTime: { fontSize: 10, fontFamily: T.FONT.regular, marginTop: 3 },
  bubbleTimeOwn: { color: T.TEXT_3, textAlign: 'right' },
  bubbleTimeOther: { color: T.TEXT_3, textAlign: 'left', marginLeft: 4 },

  dateSep: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
    gap: 10,
  },
  dateSepLine: { flex: 1, height: 1, backgroundColor: T.BORDER },
  dateSepText: {
    fontSize: 11,
    fontFamily: T.FONT.medium,
    color: T.TEXT_3,
    letterSpacing: 0.4,
  },

  emptyChat: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  emptyChatName: { fontSize: 18, fontFamily: T.FONT.bold, color: T.TEXT, marginTop: 4 },
  emptyChatHint: { fontSize: 14, fontFamily: T.FONT.regular, color: T.TEXT_2 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: T.BORDER,
    gap: 10,
    backgroundColor: T.BG,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    backgroundColor: T.SURFACE,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: T.SURFACE_2 },
});
