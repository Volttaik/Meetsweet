import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Bell, Search } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsAvatar } from '@/components/MsAvatar';
import { MsPostSkeleton } from '@/components/MsSkeletonCard';
import { MsSectionHeader } from '@/components/MsSectionHeader';
import { MsCreatorCard } from '@/components/MsCreatorCard';

// ─── Stories ──────────────────────────────────────────────────────────────────

const STORIES = [
  { key: 'you', label: 'Your Story', isYou: true },
  { key: 'alex', label: 'alex.m' },
  { key: 'sarah', label: 'sarah_' },
  { key: 'luna', label: 'luna.k' },
  { key: 'devio', label: 'dev.io' },
  { key: 'crtv', label: 'creativx' },
  { key: 'jay', label: 'jay.t' },
];

function StoryItem({ label, isYou = false }: { label: string; isYou?: boolean }) {
  return (
    <TouchableOpacity style={styles.storyItem} activeOpacity={0.75}>
      <View style={[styles.storyRing, isYou && styles.storyRingMuted]}>
        <View style={styles.storyAvatar}>
          {isYou ? (
            <Text style={styles.storyPlus}>+</Text>
          ) : (
            <Text style={styles.storyInitial}>{label[0].toUpperCase()}</Text>
          )}
        </View>
      </View>
      <Text style={styles.storyLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

// ─── Hashtag chip ─────────────────────────────────────────────────────────────

const TAGS = ['creators', 'exclusive', 'trending', 'lifestyle', 'arts', 'music', 'tech', 'fitness'];

function HashtagChip({ tag }: { tag: string }) {
  return (
    <TouchableOpacity style={styles.chip} activeOpacity={0.7}>
      <Text style={styles.chipText}>#{tag}</Text>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>

      {/* ── Top bar ── */}
      <View style={styles.topBar}>
        <TouchableOpacity activeOpacity={0.75}>
          <MsAvatar size={36} initials="U" />
        </TouchableOpacity>
        <View style={styles.greetingWrap}>
          <Text style={styles.greeting}>Good morning 👋</Text>
          <Text style={styles.handle}>@username</Text>
        </View>
        <View style={styles.topActions}>
          <TouchableOpacity
            style={styles.iconBtn}
            activeOpacity={0.7}
            onPress={() => router.push('/notifications')}
          >
            <Bell size={20} color={T.TEXT} strokeWidth={1.8} />
            <View style={styles.notifDot} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} activeOpacity={0.7}>
            <Search size={20} color={T.TEXT} strokeWidth={1.8} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Scrollable body ── */}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Stories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.storiesRow}>
          {STORIES.map((s) => (
            <StoryItem key={s.key} label={s.label} isYou={s.isYou} />
          ))}
        </ScrollView>

        <View style={styles.divider} />

        {/* Trending creators */}
        <MsSectionHeader title="Trending Creators" actionLabel="See All" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {[1, 2, 3, 4, 5].map((id) => <MsCreatorCard key={id} id={id} variant="compact" />)}
        </ScrollView>

        {/* Trending hashtags */}
        <MsSectionHeader title="Trending Now" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tagsRow}>
          {TAGS.map((t) => <HashtagChip key={t} tag={t} />)}
        </ScrollView>

        <View style={styles.divider} />

        {/* Suggested for you */}
        <MsSectionHeader title="Suggested For You" actionLabel="See All" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {[3, 4, 5, 6, 7].map((id) => <MsCreatorCard key={id} id={id} variant="featured" />)}
        </ScrollView>

        {/* Skeleton feed posts */}
        <MsSectionHeader title="Latest Posts" />
        {[1, 2, 3, 4].map((id) => <MsPostSkeleton key={id} />)}

        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

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
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: T.TEXT,
    borderWidth: 1.5,
    borderColor: T.BG,
  },

  scroll: { flex: 1 },
  scrollContent: { paddingTop: 4 },

  storiesRow: { paddingHorizontal: 20, gap: 16, paddingVertical: 12 },
  storyItem: { alignItems: 'center', gap: 5, width: 64 },
  storyRing: {
    width: 58,
    height: 58,
    borderRadius: 29,
    borderWidth: 2,
    borderColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 2,
  },
  storyRingMuted: { borderColor: T.BORDER_2 },
  storyAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: T.SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyPlus: { fontSize: 24, color: T.TEXT_2, fontFamily: T.FONT.regular, lineHeight: 28 },
  storyInitial: { fontSize: 18, fontFamily: T.FONT.semibold, color: T.TEXT_2 },
  storyLabel: { fontSize: 11, fontFamily: T.FONT.regular, color: T.TEXT_2, textAlign: 'center', width: 64 },

  divider: { height: 1, backgroundColor: T.BORDER, marginVertical: 4 },

  hScroll: { paddingHorizontal: 20, gap: 12, paddingBottom: 6 },

  tagsRow: { paddingHorizontal: 20, gap: 8, paddingBottom: 4 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: T.RADIUS.full,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
  },
  chipText: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT },
});
