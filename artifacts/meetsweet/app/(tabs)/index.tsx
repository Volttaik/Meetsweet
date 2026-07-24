import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Search } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsPostSkeleton } from '@/components/MsSkeletonCard';
import { MsSectionHeader } from '@/components/MsSectionHeader';
import { MsPostCard } from '@/components/MsPostCard';
import { MsEmptyState } from '@/components/MsEmptyState';
import { useAuth } from '@/contexts/AuthContext';
import { getFeed, type Post } from '@/services/posts';

function greetingText(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadFeed = useCallback(async (reset = false) => {
    try {
      const targetPage = reset ? 1 : page;
      const data = await getFeed(targetPage);
      if (reset) {
        setPosts(data.posts);
        setPage(2);
      } else {
        setPosts((prev) => [...prev, ...data.posts]);
        setPage((p) => p + 1);
      }
      setHasMore(data.hasMore);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [page]);

  useEffect(() => {
    loadFeed(true);
  }, []);

  const handleRefresh = () => {
    setRefreshing(true);
    loadFeed(true);
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && !loading) {
      setLoadingMore(true);
      loadFeed();
    }
  };

  const initials = user?.name
    ? user.name.split(' ').map((w) => w[0]?.toUpperCase() ?? '').slice(0, 2).join('')
    : 'U';

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => router.push('/(tabs)/profile')}
        >
          <MsAvatar
            size={36}
            initials={initials}
            imageUri={user?.avatarUrl ?? undefined}
          />
        </TouchableOpacity>
        <View style={styles.greetingWrap}>
          <Text style={styles.greeting}>{greetingText()} 👋</Text>
          <Text style={styles.handle}>@{user?.username ?? 'username'}</Text>
        </View>
        <View style={styles.topActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/notifications')}
          >
            <Bell size={20} color={T.TEXT} strokeWidth={1.8} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <Search size={20} color={T.TEXT} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Feed ── */}
      {loading ? (
        <View style={styles.skeletons}>
          {[1, 2, 3].map((id) => <MsPostSkeleton key={id} />)}
        </View>
      ) : error ? (
        <MsEmptyState
          title="Feed unavailable"
          message="Couldn't load posts. Pull down to try again."
          actionLabel="Retry"
          onAction={handleRefresh}
        />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MsPostCard
              post={item}
              currentUserId={user?.id}
              onAuthorPress={() => router.push(`/creator/${item.author.username}`)}
              onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={T.TEXT}
            />
          }
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.4}
          ListHeaderComponent={
            <MsSectionHeader title="Latest Posts" />
          }
          ListEmptyComponent={
            <MsEmptyState
              emoji="✨"
              title="No posts yet"
              message="Be the first to share something. Tap + to create your first post."
              actionLabel="Create post"
              onAction={() => router.push('/create-post')}
            />
          }
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footer}>
                {[1, 2].map((id) => <MsPostSkeleton key={id} />)}
              </View>
            ) : null
          }
          showsVerticalScrollIndicator={false}
          contentContainerStyle={posts.length === 0 ? styles.emptyContainer : undefined}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: T.BG },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  greetingWrap: { flex: 1 },
  greeting: { fontSize: 14, fontFamily: T.FONT.semibold, color: T.TEXT, letterSpacing: -0.1 },
  handle: { fontSize: 12, fontFamily: T.FONT.regular, color: T.TEXT_2 },
  topActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  skeletons: { flex: 1 },
  emptyContainer: { flexGrow: 1 },
  footer: {},
});
