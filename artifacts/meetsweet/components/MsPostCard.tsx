import React, { useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Heart, ChatCircle, Bookmark, DotsThree, SealCheck, Play } from 'phosphor-react-native';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import type { Post } from '@/services/posts';
import { likePost, unlikePost, bookmarkPost, unbookmarkPost, deletePost, reportPost } from '@/services/posts';

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}

interface MsPostCardProps {
  post: Post;
  onPress?: () => void;
  onAuthorPress?: () => void;
  onDeleted?: (id: string) => void;
  currentUserId?: string;
}

export function MsPostCard({
  post,
  onPress,
  onAuthorPress,
  onDeleted,
  currentUserId,
}: MsPostCardProps) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [liking, setLiking] = useState(false);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByMe ?? false);
  const [bookmarking, setBookmarking] = useState(false);

  const isOwn = currentUserId && currentUserId === post.author.id;

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount((c) => (wasLiked ? Math.max(0, c - 1) : c + 1));
    try {
      if (wasLiked) {
        const res = await unlikePost(post.id);
        setLikeCount(res.likeCount);
      } else {
        const res = await likePost(post.id);
        setLikeCount(res.likeCount);
      }
    } catch {
      setLiked(wasLiked);
      setLikeCount((c) => (wasLiked ? c + 1 : Math.max(0, c - 1)));
    } finally {
      setLiking(false);
    }
  };

  const handleBookmark = async () => {
    if (bookmarking) return;
    setBookmarking(true);
    const was = bookmarked;
    setBookmarked(!was);
    try {
      if (was) {
        await unbookmarkPost(post.id);
      } else {
        await bookmarkPost(post.id);
      }
    } catch {
      setBookmarked(was);
    } finally {
      setBookmarking(false);
    }
  };

  const handleMore = () => {
    const ownOptions = ['Edit Post', 'Delete Post', 'Cancel'];
    const guestOptions = ['Report', 'Cancel'];
    const options = isOwn ? ownOptions : guestOptions;

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: isOwn ? 1 : 3,
          cancelButtonIndex: options.length - 1,
        },
        (idx) => handleMoreAction(options[idx]),
      );
    } else {
      Alert.alert('Post Options', undefined, [
        ...options
          .filter((o) => o !== 'Cancel')
          .map((label) => ({
            text: label,
             style: (label === 'Delete Post' || label === 'Report') ? ('destructive' as const) : ('default' as const),
            onPress: () => handleMoreAction(label),
          })),
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  };

  const handleMoreAction = async (action: string) => {
    switch (action) {
      case 'Delete Post':
        Alert.alert('Delete Post', 'This cannot be undone.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await deletePost(post.id);
                onDeleted?.(post.id);
              } catch (e) {
                Alert.alert('Error', 'Could not delete post.');
              }
            },
          },
        ]);
        break;
      case 'Report':
        Alert.alert('Report post', 'Why are you reporting this post?', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Inappropriate', onPress: () => reportPost(post.id, 'inappropriate').catch(() => Alert.alert('Error', 'Could not report post.')) },
          { text: 'Something else', onPress: () => reportPost(post.id, 'other').catch(() => Alert.alert('Error', 'Could not report post.')) },
        ]);
        break;
      default:
        break;
    }
  };

  const inits = post.author.name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  return (
    <View style={styles.card}>
      {/* Author row */}
      <View style={styles.authorRow}>
        <TouchableOpacity onPress={onAuthorPress} style={styles.authorLeft} activeOpacity={0.75}>
          <MsAvatar size={38} initials={inits} imageUri={post.author.avatarUrl ?? undefined} />
          <View style={styles.authorInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.authorName} numberOfLines={1}>
                {post.author.name}
              </Text>
              {post.author.isVerified && (
                <SealCheck size={14} color={T.TEXT} />
              )}
            </View>
            <Text style={styles.authorMeta}>
              @{post.author.username} · {formatTime(post.createdAt)}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={styles.authorRight}>
          {post.isPremium && (
            <View style={styles.premiumBadge}>
              <Text style={styles.premiumText}>PREMIUM</Text>
            </View>
          )}
          <TouchableOpacity
            style={styles.moreBtn}
            activeOpacity={0.7}
            onPress={handleMore}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <DotsThree size={18} color={T.TEXT_2} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Caption */}
      {!!post.caption && (
        <Text style={styles.caption} numberOfLines={3}>
          {post.caption}
        </Text>
      )}

      {/* Media — image */}
      {post.mediaUrl && post.mediaType === 'image' && (
        <TouchableOpacity onPress={onPress} activeOpacity={0.92}>
          <Image source={{ uri: post.mediaUrl }} style={styles.media} resizeMode="cover" />
        </TouchableOpacity>
      )}

      {/* Media — video */}
      {post.mediaUrl && post.mediaType === 'video' && (
        <TouchableOpacity onPress={onPress} style={styles.videoPlaceholder} activeOpacity={0.85}>
          <View style={styles.videoOverlay}>
            <View style={styles.playBtn}>
               <Play size={20} color={T.TEXT} weight="fill" />
            </View>
            {post.durationSecs != null && (
              <Text style={styles.duration}>
                {Math.floor(post.durationSecs / 60)}:
                {String(post.durationSecs % 60).padStart(2, '0')}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {/* Like */}
        <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.7}>
          <Heart
            size={18}
            color={liked ? '#EF4444' : T.TEXT_2}
           
            weight={liked ? 'fill' : 'regular'}
          />
          {likeCount > 0 && (
            <Text style={[styles.actionCount, liked && styles.actionCountLiked]}>
              {formatCount(likeCount)}
            </Text>
          )}
        </TouchableOpacity>

        {/* Comment */}
        <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7}>
          <ChatCircle size={18} color={T.TEXT_2} />
          {post.commentCount > 0 && (
            <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
          )}
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        {/* Bookmark */}
        <TouchableOpacity style={styles.actionBtn} onPress={handleBookmark} activeOpacity={0.7}>
          <Bookmark
            size={18}
            color={bookmarked ? T.TEXT : T.TEXT_2}
           
            weight={bookmarked ? 'fill' : 'regular'}
          />
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: T.BG },

  authorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 10,
  },
  authorLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  authorInfo: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  authorName: {
    fontSize: 14,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
    flexShrink: 1,
  },
  authorMeta: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    marginTop: 1,
  },
  authorRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  premiumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: T.RADIUS.xs,
    backgroundColor: T.SURFACE_2,
  },
  premiumText: {
    fontSize: 9,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: 0.5,
  },
  moreBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  caption: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT,
    lineHeight: 21,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },

  media: { width: '100%', aspectRatio: 1, backgroundColor: T.SURFACE },

  videoPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoOverlay: { alignItems: 'center', gap: 10 },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  duration: { fontSize: 12, fontFamily: T.FONT.medium, color: 'rgba(255,255,255,0.7)' },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
  },
  actionBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    gap: 5,
    justifyContent: 'center',
  },
  actionCount: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT_2 },
  actionCountLiked: { color: '#EF4444' },

  divider: { height: 1, backgroundColor: T.BORDER, marginTop: 2 },
});
