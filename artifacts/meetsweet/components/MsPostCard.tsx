import React, { useState } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Heart, MessageCircle, Bookmark, MoreHorizontal, BadgeCheck } from 'lucide-react-native';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import type { Post } from '@/services/posts';
import { likePost, unlikePost } from '@/services/posts';

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
}

export function MsPostCard({ post, onPress, onAuthorPress }: MsPostCardProps) {
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [liking, setLiking] = useState(false);

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    const wasLiked = liked;
    // Optimistic update
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
      // Revert optimistic update
      setLiked(wasLiked);
      setLikeCount((c) => (wasLiked ? c + 1 : Math.max(0, c - 1)));
    } finally {
      setLiking(false);
    }
  };

  const initials = post.author.name
    .split(' ')
    .map((w) => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');

  return (
    <View style={styles.card}>
      {/* Author row */}
      <View style={styles.authorRow}>
        <TouchableOpacity
          onPress={onAuthorPress}
          style={styles.authorLeft}
          activeOpacity={0.75}
        >
          <MsAvatar size={38} initials={initials} imageUri={post.author.avatarUrl ?? undefined} />
          <View style={styles.authorInfo}>
            <View style={styles.nameRow}>
              <Text style={styles.authorName} numberOfLines={1}>
                {post.author.name}
              </Text>
              {post.author.isVerified && (
                <BadgeCheck size={14} color={T.TEXT} strokeWidth={2} />
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
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MoreHorizontal size={18} color={T.TEXT_2} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Caption */}
      {!!post.caption && (
        <Text style={styles.caption} numberOfLines={3}>
          {post.caption}
        </Text>
      )}

      {/* Media */}
      {post.mediaUrl && post.mediaType === 'image' && (
        <TouchableOpacity onPress={onPress} activeOpacity={0.92}>
          <Image
            source={{ uri: post.mediaUrl }}
            style={styles.media}
            resizeMode="cover"
          />
        </TouchableOpacity>
      )}

      {/* Video placeholder */}
      {post.mediaUrl && post.mediaType === 'video' && (
        <TouchableOpacity onPress={onPress} style={styles.videoPlaceholder} activeOpacity={0.85}>
          <View style={styles.videoOverlay}>
            <View style={styles.playBtn}>
              <Text style={styles.playIcon}>▶</Text>
            </View>
            {post.durationSecs && (
              <Text style={styles.duration}>
                {Math.floor(post.durationSecs / 60)}:{String(post.durationSecs % 60).padStart(2, '0')}
              </Text>
            )}
          </View>
        </TouchableOpacity>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionBtn} onPress={handleLike} activeOpacity={0.7}>
          <Heart
            size={20}
            color={liked ? '#EF4444' : T.TEXT_2}
            strokeWidth={1.8}
            fill={liked ? '#EF4444' : 'transparent'}
          />
          {likeCount > 0 && (
            <Text style={[styles.actionCount, liked && styles.actionCountLiked]}>
              {formatCount(likeCount)}
            </Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7}>
          <MessageCircle size={20} color={T.TEXT_2} strokeWidth={1.8} />
          {post.commentCount > 0 && (
            <Text style={styles.actionCount}>{formatCount(post.commentCount)}</Text>
          )}
        </TouchableOpacity>

        <View style={{ flex: 1 }} />

        <TouchableOpacity style={styles.actionBtn} activeOpacity={0.7}>
          <Bookmark size={20} color={T.TEXT_2} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      {/* Bottom divider */}
      <View style={styles.divider} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: T.BG,
  },

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
  authorRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  premiumBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: T.RADIUS.xs,
    backgroundColor: T.SURFACE_2,
    borderWidth: 1,
    borderColor: T.BORDER_2,
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

  media: {
    width: '100%',
    aspectRatio: 1,
    backgroundColor: T.SURFACE,
  },

  videoPlaceholder: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoOverlay: {
    alignItems: 'center',
    gap: 10,
  },
  playBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playIcon: {
    fontSize: 20,
    color: '#FFFFFF',
    marginLeft: 4,
  },
  duration: {
    fontSize: 12,
    fontFamily: T.FONT.medium,
    color: 'rgba(255,255,255,0.7)',
  },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 4,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  actionCount: {
    fontSize: 13,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  actionCountLiked: {
    color: '#EF4444',
  },

  divider: {
    height: 1,
    backgroundColor: T.BORDER,
    marginTop: 2,
  },
});
