import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Settings, Share2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsSkeletonCard } from '@/components/MsSkeletonCard';
import { MsPostCard } from '@/components/MsPostCard';
import { MsEmptyState } from '@/components/MsEmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { getUserPosts, getBookmarkedPosts, type Post } from '@/services/posts';

const PROFILE_TABS = ['Posts', 'Media', 'Saved'] as const;
type ProfileTab = typeof PROFILE_TABS[number];

function StatItem({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={statStyles.wrap}>
      <Text style={statStyles.value}>{value}</Text>
      <Text style={statStyles.label}>{label}</Text>
    </View>
  );
}
const statStyles = StyleSheet.create({
  wrap: { alignItems: 'center', flex: 1 },
  value: { fontSize: 18, fontFamily: T.FONT.bold, color: T.TEXT, letterSpacing: -0.3 },
  label: { fontSize: 12, fontFamily: T.FONT.regular, color: T.TEXT_2, marginTop: 2 },
});

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user, refreshUser } = useAuth();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');
  const [posts, setPosts] = useState<Post[]>([]);
  const [savedPosts, setSavedPosts] = useState<Post[]>([]);
  const [loadingPosts, setLoadingPosts] = useState(true);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const gridItemSize = Math.floor((width - 2) / 3);

  const loadPosts = useCallback(async () => {
    if (!user) return;
    try {
      const data = await getUserPosts(user.id);
      setPosts(data.posts);
    } catch {
      // ignore
    } finally {
      setLoadingPosts(false);
      setRefreshing(false);
    }
  }, [user]);

  const loadSavedPosts = useCallback(async () => {
    setLoadingSaved(true);
    try {
      const data = await getBookmarkedPosts();
      setSavedPosts(data.posts);
    } catch {
      // ignore
    } finally {
      setLoadingSaved(false);
    }
  }, []);

  useEffect(() => {
    loadPosts();
  }, [user?.id]);

  useEffect(() => {
    if (activeTab === 'Saved') loadSavedPosts();
  }, [activeTab]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await Promise.all([refreshUser(), loadPosts()]);
  };

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')
    : 'U';

  const mediaPosts = posts.filter((p) => !!p.mediaUrl);

  const tabContent = () => {
    if (activeTab === 'Posts') {
      if (loadingPosts) {
        return (
          <View style={styles.grid}>
            {Array.from({ length: 9 }).map((_, i) => (
              <MsSkeletonCard key={i} style={{ width: gridItemSize, height: gridItemSize }} radius={0} />
            ))}
          </View>
        );
      }
      if (posts.length === 0) {
        return (
          <MsEmptyState
            emoji="📸"
            title="No posts yet"
            message="Tap the + button to share your first post with the world."
            actionLabel="Create post"
            onAction={() => router.push('/create-post')}
          />
        );
      }
      return (
        <View style={[styles.grid, { gap: 1, backgroundColor: T.BORDER }]}>
          {posts.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={{ width: gridItemSize, height: gridItemSize, backgroundColor: T.SURFACE }}
              activeOpacity={0.8}
            >
              {p.mediaUrl && (
                // Show media preview (image thumbnail)
                <View style={{ flex: 1, backgroundColor: T.SURFACE_2, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: T.TEXT_3, fontSize: 11, fontFamily: T.FONT.medium }}>
                    {p.mediaType === 'video' ? '▶' : '📷'}
                  </Text>
                </View>
              )}
              {!p.mediaUrl && (
                <View style={{ flex: 1, backgroundColor: T.SURFACE, padding: 8 }}>
                  <Text style={{ color: T.TEXT_2, fontSize: 11, fontFamily: T.FONT.regular }} numberOfLines={4}>
                    {p.caption}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          ))}
        </View>
      );
    }
    if (activeTab === 'Media') {
      if (mediaPosts.length === 0) {
        return (
          <MsEmptyState
            emoji="🖼️"
            title="No media yet"
            message="Post photos or videos to see them here."
          />
        );
      }
      return (
        <View style={[styles.grid, { gap: 1, backgroundColor: T.BORDER }]}>
          {mediaPosts.map((p) => (
            <View
              key={p.id}
              style={{ width: gridItemSize, height: gridItemSize, backgroundColor: T.SURFACE_2, alignItems: 'center', justifyContent: 'center' }}
            >
              <Text style={{ color: T.TEXT_3, fontSize: 11 }}>
                {p.mediaType === 'video' ? '▶' : '📷'}
              </Text>
            </View>
          ))}
        </View>
      );
    }
    // Saved
    if (loadingSaved) {
      return (
        <View style={styles.grid}>
          {Array.from({ length: 9 }).map((_, i) => (
            <MsSkeletonCard key={i} style={{ width: gridItemSize, height: gridItemSize }} radius={0} />
          ))}
        </View>
      );
    }
    if (savedPosts.length === 0) {
      return (
        <MsEmptyState
          emoji="🔖"
          title="No saved posts"
          message="Posts you bookmark will appear here."
        />
      );
    }
    return (
      <View style={[styles.grid, { gap: 1, backgroundColor: T.BORDER }]}>
        {savedPosts.map((p) => (
          <View
            key={p.id}
            style={{ width: gridItemSize, height: gridItemSize, backgroundColor: T.SURFACE_2, alignItems: 'center', justifyContent: 'center' }}
          >
            <Text style={{ color: T.TEXT_3, fontSize: 11 }}>
              {p.mediaType === 'video' ? '▶' : p.mediaUrl ? '📷' : '📝'}
            </Text>
          </View>
        ))}
      </View>
    );
  };

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={T.TEXT} />
        }
      >

        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.topUsername}>@{user?.username ?? 'username'}</Text>
          <View style={styles.topActions}>
            <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
              <Share2 size={18} color={T.TEXT} strokeWidth={1.8} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => router.push('/settings')} activeOpacity={0.7}>
              <Settings size={18} color={T.TEXT} strokeWidth={1.8} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Cover */}
        <View style={[styles.cover, user?.bannerUrl ? { backgroundColor: T.SURFACE_2 } : {}]} />

        {/* Avatar + action buttons row */}
        <View style={styles.avatarRow}>
          <View style={styles.avatarBorder}>
            <MsAvatar size={82} initials={initials} imageUri={user?.avatarUrl ?? undefined} />
          </View>
          <View style={{ flex: 1 }} />
          <View style={[styles.profileActions, { paddingBottom: 6 }]}>
            <TouchableOpacity style={styles.editBtn} activeOpacity={0.8}>
              <Text style={styles.editLabel}>Edit Profile</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* User info */}
        <View style={styles.userInfo}>
          <Text style={styles.displayName}>{user?.name ?? 'Display Name'}</Text>
          <Text style={styles.handle}>@{user?.username ?? 'username'}</Text>
          {!!user?.bio && (
            <Text style={styles.bio}>{user.bio}</Text>
          )}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatItem label="Followers" value={formatCount(user?.followerCount ?? 0)} />
          <View style={styles.statsDivider} />
          <StatItem label="Following" value={formatCount(user?.followingCount ?? 0)} />
          <View style={styles.statsDivider} />
          <StatItem label="Posts" value={formatCount(user?.postCount ?? 0)} />
        </View>

        {/* Content tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.contentTabsScroll}
          contentContainerStyle={styles.contentTabsRow}
        >
          {PROFILE_TABS.map((tab) => {
            const isActive = tab === activeTab;
            return (
              <TouchableOpacity
                key={tab}
                onPress={() => setActiveTab(tab)}
                style={[styles.contentTab, isActive && styles.contentTabActive]}
                activeOpacity={0.7}
              >
                <Text style={[styles.contentTabLabel, isActive && styles.contentTabLabelActive]}>
                  {tab}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Tab content */}
        {tabContent()}

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: T.BG },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  topUsername: { fontSize: 16, fontFamily: T.FONT.bold, color: T.TEXT, letterSpacing: -0.2 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cover: { height: 130, backgroundColor: T.SURFACE },

  avatarRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    marginTop: -42,
    gap: 12,
  },
  avatarBorder: {
    borderWidth: 3,
    borderColor: T.BG,
    borderRadius: 44,
    overflow: 'hidden',
  },
  profileActions: { alignItems: 'flex-end' },
  editBtn: {
    paddingHorizontal: 20,
    height: 34,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editLabel: { fontSize: 13, fontFamily: T.FONT.semibold, color: T.TEXT },

  userInfo: { paddingHorizontal: 20, paddingTop: 14, gap: 4 },
  displayName: { fontSize: 18, fontFamily: T.FONT.bold, color: T.TEXT, letterSpacing: -0.3 },
  handle: { fontSize: 14, fontFamily: T.FONT.regular, color: T.TEXT_2 },
  bio: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    lineHeight: 21,
    marginTop: 6,
  },

  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  statsDivider: { width: 1, height: 28, backgroundColor: T.BORDER_2 },

  contentTabsScroll: { borderBottomWidth: 1, borderBottomColor: T.BORDER },
  contentTabsRow: { paddingHorizontal: 16 },
  contentTab: {
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  contentTabActive: { borderBottomColor: T.TEXT },
  contentTabLabel: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT_2 },
  contentTabLabelActive: { color: T.TEXT, fontFamily: T.FONT.semibold },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
});
