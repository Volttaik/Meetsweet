import React, { useState } from 'react';
import {
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

const PROFILE_TABS = ['Posts', 'Media', 'Likes', 'Bookmarks', 'Saved'] as const;
type ProfileTab = typeof PROFILE_TABS[number];

function StatItem({ label, value }: { label: string; value: string }) {
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

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<ProfileTab>('Posts');

  const gridItemSize = Math.floor((width - 2) / 3);

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 20 }}>

        {/* Top bar */}
        <View style={styles.topBar}>
          <Text style={styles.topUsername}>@username</Text>
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
        <View style={styles.cover} />

        {/* Avatar + action buttons row */}
        <View style={styles.avatarRow}>
          <View style={styles.avatarBorder}>
            <MsAvatar size={82} initials="U" />
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
          <Text style={styles.displayName}>Display Name</Text>
          <Text style={styles.handle}>@username</Text>
          <Text style={styles.bio}>
            Content creator & visual storyteller.{'\n'}
            Sharing moments that inspire ✨
          </Text>
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <StatItem label="Followers" value="24.7K" />
          <View style={styles.statsDivider} />
          <StatItem label="Following" value="348" />
          <View style={styles.statsDivider} />
          <StatItem label="Likes" value="102K" />
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

        {/* Content grid — 3 column placeholder */}
        <View style={[styles.grid, { gap: 1, backgroundColor: T.BORDER }]}>
          {Array.from({ length: 12 }).map((_, i) => (
            <MsSkeletonCard
              key={i}
              style={{ width: gridItemSize, height: gridItemSize }}
              radius={0}
            />
          ))}
        </View>

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
