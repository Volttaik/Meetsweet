import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, ChatCircle, DotsThree, Lock, PaperPlaneTilt } from 'phosphor-react-native';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsEmptyState } from '@/components/MsEmptyState';
import { MsPostCard } from '@/components/MsPostCard';
import { useAuth } from '@/contexts/AuthContext';
import {
  addComment,
  addReply,
  deleteComment,
  editComment,
  getComments,
  getPost,
  reportPost,
  type Comment,
  type Post,
} from '@/services/posts';

function initials(name: string) {
  return name.split(' ').map((part) => part[0]?.toUpperCase() ?? '').slice(0, 2).join('');
}

export default function PostDetailScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [post, setPost] = useState<Post | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [postResult, commentResult] = await Promise.all([getPost(id), getComments(id)]);
      setPost(postResult.post);
      setComments(commentResult.comments);
      setError('');
    } catch {
      setError('This post is unavailable right now.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const submitComment = async () => {
    const body = draft.trim();
    if (!body || !id || sending) return;
    setSending(true);
    try {
      const result = replyingTo
        ? await addReply(id, replyingTo.id, body)
        : await addComment(id, body);
      if (replyingTo) {
        setComments((items) => items.map((item) =>
          item.id === replyingTo.id ? { ...item, replyCount: item.replyCount + 1 } : item,
        ));
      } else {
        setComments((items) => [...items, result.comment]);
        setPost((current) => current ? { ...current, commentCount: current.commentCount + 1 } : current);
      }
      setDraft('');
      setReplyingTo(null);
    } catch {
      Alert.alert('Could not post comment', 'Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleCommentMenu = (comment: Comment) => {
    const own = comment.author.id === user?.id;
    const options = own ? ['Edit', 'Delete', 'Cancel'] : ['Reply', 'Cancel'];
    Alert.alert('Comment', undefined, [
      ...options.filter((option) => option !== 'Cancel').map((option) => ({
        text: option,
        style: option === 'Delete' ? 'destructive' as const : 'default' as const,
        onPress: () => {
          if (option === 'Reply') {
            setReplyingTo(comment);
          } else if (option === 'Edit') {
            Alert.prompt(
              'Edit comment',
              undefined,
              async (body) => {
                if (!body?.trim() || !id) return;
                try {
                  await editComment(id, comment.id, body);
                  setComments((items) => items.map((item) =>
                    item.id === comment.id ? { ...item, body: body.trim() } : item,
                  ));
                } catch {
                  Alert.alert('Could not edit comment', 'Please try again.');
                }
              },
              'plain-text',
              comment.body,
            );
          } else if (option === 'Delete') {
            Alert.alert('Delete comment?', 'This cannot be undone.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                  if (!id) return;
                  try {
                    await deleteComment(id, comment.id);
                    setComments((items) => items.filter((item) => item.id !== comment.id));
                    setPost((current) => current ? {
                      ...current,
                      commentCount: Math.max(0, current.commentCount - (comment.parentId ? 0 : 1)),
                    } : current);
                  } catch {
                    Alert.alert('Could not delete comment', 'Please try again.');
                  }
                },
              },
            ]);
          }
        },
      })),
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  if (loading) {
    return <View style={[styles.center, { paddingTop: insets.top }]}><Text style={styles.muted}>Loading post…</Text></View>;
  }

  if (error || !post) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <MsEmptyState title="Post unavailable" message={error} actionLabel="Go back" onAction={() => router.back()} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 48}
    >
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.iconButton} onPress={() => router.back()} accessibilityLabel="Go back">
          <ArrowLeft size={20} color={T.TEXT} />
        </Pressable>
        <Text style={styles.headerTitle}>Post</Text>
        <Pressable
          style={styles.iconButton}
          onPress={() => Alert.alert('Report post', 'Choose a reason.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Inappropriate', onPress: () => reportPost(post.id).catch(() => Alert.alert('Could not report post', 'Please try again.')) },
            { text: 'Something else', onPress: () => reportPost(post.id, 'other').catch(() => Alert.alert('Could not report post', 'Please try again.')) },
          ])}
          accessibilityLabel="Report post"
        >
          <DotsThree size={22} color={T.TEXT_2} />
        </Pressable>
      </View>

      <FlatList
        data={comments}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={
          <View>
            <MsPostCard
              post={post}
              currentUserId={user?.id}
              onAuthorPress={() => router.push(`/creator/${post.author.username}`)}
            />
            <View style={styles.commentsHeader}>
              <ChatCircle size={18} color={T.TEXT_2} />
              <Text style={styles.commentsTitle}>Comments</Text>
              <Text style={styles.commentsCount}>{comments.length}</Text>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <View style={styles.commentRow}>
            <MsAvatar size={34} initials={initials(item.author.name)} imageUri={item.author.avatarUrl ?? undefined} />
            <View style={styles.commentBody}>
              <View style={styles.commentTop}>
                <Text style={styles.commentAuthor}>{item.author.name}</Text>
                <Pressable onPress={() => handleCommentMenu(item)} hitSlop={8}>
                  <DotsThree size={18} color={T.TEXT_2} />
                </Pressable>
              </View>
              <Text style={styles.commentText}>{item.body}</Text>
              <Pressable onPress={() => setReplyingTo(item)}>
                <Text style={styles.replyAction}>{item.replyCount > 0 ? `${item.replyCount} replies · Reply` : 'Reply'}</Text>
              </Pressable>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.emptyComments}>
            <Lock size={18} color={T.TEXT_3} />
            <Text style={styles.muted}>Start the conversation.</Text>
          </View>
        }
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
      />

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        {replyingTo && (
          <View style={styles.replyingBar}>
            <Text style={styles.replyingText}>Replying to {replyingTo.author.name}</Text>
            <Pressable onPress={() => setReplyingTo(null)}><Text style={styles.cancelReply}>Cancel</Text></Pressable>
          </View>
        )}
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={replyingTo ? 'Write a reply…' : 'Add a comment…'}
            placeholderTextColor={T.TEXT_3}
            style={styles.input}
            multiline
            maxLength={500}
          />
          <Pressable
            style={[styles.sendButton, (!draft.trim() || sending) && styles.sendDisabled]}
            onPress={submitComment}
            disabled={!draft.trim() || sending}
          >
            <PaperPlaneTilt size={17} color={draft.trim() ? T.BG : T.TEXT_3} weight="fill" />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },
  center: { flex: 1, backgroundColor: T.BG, alignItems: 'center', justifyContent: 'center' },
  muted: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 14 },
  header: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  headerTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 16 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listContent: { paddingBottom: 12 },
  commentsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  commentsTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 16 },
  commentsCount: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 14 },
  commentRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  commentBody: { flex: 1 },
  commentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  commentAuthor: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 13 },
  commentText: { color: T.TEXT, fontFamily: T.FONT.regular, fontSize: 14, lineHeight: 20, marginTop: 3 },
  replyAction: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 12, marginTop: 7 },
  emptyComments: { alignItems: 'center', gap: 8, paddingVertical: 32 },
  composerWrap: { backgroundColor: T.SURFACE, paddingHorizontal: 14, paddingTop: 8 },
  replyingBar: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4, paddingBottom: 6 },
  replyingText: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 12 },
  cancelReply: { color: T.TEXT, fontFamily: T.FONT.medium, fontSize: 12 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 100,
    backgroundColor: T.SURFACE_2,
    borderRadius: T.RADIUS.lg,
    color: T.TEXT,
    fontFamily: T.FONT.regular,
    fontSize: 14,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 10,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: T.SURFACE_2 },
});