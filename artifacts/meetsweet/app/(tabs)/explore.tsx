import React, { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Search, SlidersHorizontal } from 'lucide-react-native';
import { T } from '@/constants/theme';
import { MsSectionHeader } from '@/components/MsSectionHeader';
import { MsCreatorCard } from '@/components/MsCreatorCard';

const CATEGORIES = ['All', 'Lifestyle', 'Music', 'Tech', 'Art', 'Fitness', 'Travel', 'Food', 'Gaming'];
const HASHTAGS = ['#trending', '#newcreators', '#exclusive', '#subscribe', '#lifestyle', '#art', '#music', '#tech'];
const NAMES = ['Alex Rivera', 'Sarah Moon', 'Dev Studio', 'Creative X', 'Luna Kim', 'Jay Torres', 'Mia Chen'];
const HANDLES = ['@alex.r', '@sarah_m', '@devstudio', '@creativex', '@luna.k', '@jay.t', '@mia.c'];

function SuggestedRow({ id }: { id: number }) {
  const idx = (id - 1) % NAMES.length;
  return (
    <View style={rowStyles.row}>
      <View style={rowStyles.avatar}>
        <Text style={rowStyles.avatarText}>{NAMES[idx][0]}</Text>
      </View>
      <View style={rowStyles.info}>
        <Text style={rowStyles.name}>{NAMES[idx]}</Text>
        <Text style={rowStyles.handle}>{HANDLES[idx]}</Text>
      </View>
      <TouchableOpacity style={rowStyles.followBtn} activeOpacity={0.8}>
        <Text style={rowStyles.followLabel}>Follow</Text>
      </TouchableOpacity>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: T.SURFACE_2,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 16, fontFamily: T.FONT.semibold, color: T.TEXT_2 },
  info: { flex: 1 },
  name: { fontSize: 14, fontFamily: T.FONT.semibold, color: T.TEXT },
  handle: { fontSize: 12, fontFamily: T.FONT.regular, color: T.TEXT_2 },
  followBtn: {
    paddingHorizontal: 18,
    height: 32,
    borderRadius: T.RADIUS.sm,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  followLabel: { fontSize: 12, fontFamily: T.FONT.semibold, color: T.BG },
});

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState('All');

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <TouchableOpacity style={styles.filterBtn} activeOpacity={0.7}>
          <SlidersHorizontal size={18} color={T.TEXT} strokeWidth={1.8} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Search bar */}
        <View style={styles.searchWrap}>
          <Search size={16} color={T.TEXT_2} strokeWidth={1.8} />
          <TextInput
            placeholder="Search creators, tags, content…"
            placeholderTextColor={T.TEXT_3}
            style={styles.searchInput}
            editable={false}
          />
        </View>

        {/* Categories */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.catRow}
        >
          {CATEGORIES.map((cat) => {
            const isActive = cat === activeCategory;
            return (
              <TouchableOpacity
                key={cat}
                style={[styles.catChip, isActive && styles.catChipActive]}
                onPress={() => setActiveCategory(cat)}
                activeOpacity={0.7}
              >
                <Text style={[styles.catLabel, isActive && styles.catLabelActive]}>{cat}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Trending creators */}
        <MsSectionHeader title="Trending Creators" actionLabel="See All" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {[1, 2, 3, 4, 5].map((id) => <MsCreatorCard key={id} id={id} variant="compact" />)}
        </ScrollView>

        {/* Rising stars */}
        <MsSectionHeader title="Rising Stars" actionLabel="See All" />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.hScroll}>
          {[5, 6, 7, 4, 3].map((id) => <MsCreatorCard key={id} id={id} variant="featured" />)}
        </ScrollView>

        {/* Suggested accounts */}
        <MsSectionHeader title="Suggested Accounts" />
        {[2, 4, 6].map((id) => <SuggestedRow key={id} id={id} />)}

        {/* Trending hashtags */}
        <MsSectionHeader title="Trending Hashtags" />
        <View style={styles.hashGrid}>
          {HASHTAGS.map((tag) => (
            <TouchableOpacity key={tag} style={styles.hashChip} activeOpacity={0.7}>
              <Text style={styles.hashText}>{tag}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
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
  filterBtn: {
    width: 38,
    height: 38,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: { paddingTop: 8 },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    marginBottom: 4,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    paddingHorizontal: 14,
    height: 44,
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

  catRow: { paddingHorizontal: 20, gap: 8, paddingVertical: 12 },
  catChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: T.RADIUS.full,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
  },
  catChipActive: { backgroundColor: T.TEXT, borderColor: T.TEXT },
  catLabel: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT_2 },
  catLabelActive: { color: T.BG },

  hScroll: { paddingHorizontal: 20, gap: 12, paddingBottom: 6 },

  hashGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 10,
    marginBottom: 8,
  },
  hashChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: T.RADIUS.full,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
  },
  hashText: { fontSize: 13, fontFamily: T.FONT.medium, color: T.TEXT },
});
