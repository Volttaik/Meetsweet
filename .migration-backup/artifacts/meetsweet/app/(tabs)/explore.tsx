import React, { useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, CaretRight, CreditCard, MagnifyingGlass as SearchIcon, Wallet } from 'phosphor-react-native';
import { useGetExploreCatalog, type Creator } from '@workspace/api-client-react';
import { Chip, Input } from 'heroui-native';
import {
  MsCatalogSkeleton,
  MsCollectionCard,
  MsFeaturedCreatorCard,
  MsPreviewCard,
  MsRecommendedCreatorRow,
} from '@/components/MsExploreVisual';
import { MsEmptyState } from '@/components/MsEmptyState';
import { MsSectionHeader } from '@/components/MsSectionHeader';
import { MsActionSheet, type ActionItem } from '@/components/MsActionSheet';
import { MsCreatorPreview, type CreatorPreviewData } from '@/components/MsCreatorPreview';
import { T } from '@/constants/theme';

// ─── Creator-focused category list ────────────────────────────────────────────

const CREATOR_CATEGORIES = [
  { id: 'all',                label: 'All' },
  { id: 'trending',           label: 'Trending' },
  { id: 'new',                label: 'New Creators' },
  { id: 'premium',            label: 'Premium' },
  { id: 'lifestyle',          label: 'Lifestyle' },
  { id: 'fashion',            label: 'Fashion' },
  { id: 'fitness',            label: 'Fitness' },
  { id: 'models',             label: 'Models' },
  { id: 'photography',        label: 'Photography' },
  { id: 'gaming',             label: 'Gaming' },
  { id: 'music',              label: 'Music' },
  { id: 'dance',              label: 'Dance' },
  { id: 'comedy',             label: 'Comedy' },
  { id: 'education',          label: 'Education' },
  { id: 'art',                label: 'Art' },
  { id: 'cooking',            label: 'Cooking' },
  { id: 'travel',             label: 'Travel' },
  { id: 'technology',         label: 'Technology' },
  { id: 'cars',               label: 'Cars' },
  { id: 'luxury',             label: 'Luxury' },
  { id: 'behind-the-scenes',  label: 'Behind the Scenes' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function findCreator(creators: Creator[], id: string) {
  return creators.find((c) => c.id === id);
}

function creatorMatchesCategory(creator: Creator, categoryId: string): boolean {
  if (categoryId === 'all') return true;
  if (categoryId === 'trending') return true; // show all as "trending" for now
  if (categoryId === 'new') return true;       // show all as "new" for now
  if (categoryId === 'premium') return Number(creator.monthlyCredits ?? 0) > 0;
  const cat = String(creator.category ?? '').toLowerCase();
  // Match "behind-the-scenes" → "behind the scenes"
  const normalized = categoryId.replace(/-/g, ' ');
  return cat.includes(normalized) || cat === categoryId;
}

function toPreviewData(creator: Creator): CreatorPreviewData {
  return {
    id: creator.id,
    name: creator.name,
    handle: creator.handle,
    bio: creator.bio,
    initials: creator.initials,
    isVerified: creator.isVerified,
    isOnline: creator.isOnline,
    followers: creator.followers,
    monthlyCredits: creator.monthlyCredits,
    category: creator.category,
  };
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  // Long-press context menu
  const [menuCreator, setMenuCreator] = useState<Creator | null>(null);

  // Avatar-tap preview card
  const [previewCreator, setPreviewCreator] = useState<CreatorPreviewData | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);

  const query = useGetExploreCatalog();
  const catalog = query.data;
  const creators = catalog?.creators ?? [];
  const previewsData = catalog?.previews ?? [];
  const featuredCreatorIds = catalog?.featuredCreatorIds ?? [];
  const recommendedCreatorIds = catalog?.recommendedCreatorIds ?? [];
  const trendingSearches = catalog?.trendingSearches ?? ['slow living', 'new creators', 'exclusive'];
  const creditBalance = Number(catalog?.creditBalance ?? 0);

  const visibleCreators = useMemo(() => {
    if (!catalog) return [];
    const needle = search.trim().toLowerCase();
    return creators.filter((creator) => {
      const categoryMatch = creatorMatchesCategory(creator, activeCategory);
      const searchMatch =
        !needle ||
        `${creator.name ?? ''} ${creator.handle ?? ''} ${creator.bio ?? ''} ${creator.category ?? ''}`
          .toLowerCase()
          .includes(needle);
      return categoryMatch && searchMatch;
    });
  }, [activeCategory, catalog, creators, search]);

  const featured = featuredCreatorIds
    .map((id) => findCreator(creators, id))
    .filter(Boolean) as Creator[];

  const recommended = recommendedCreatorIds
    .map((id) => findCreator(creators, id))
    .filter(Boolean) as Creator[];

  const previews = previewsData.filter((preview) => {
    const creator = findCreator(creators, preview.creatorId);
    return (
      creator &&
      (activeCategory === 'all' || creatorMatchesCategory(creator, activeCategory))
    );
  });

  const openCreator = (creator: Creator) => router.push(`/creator/${creator.id}`);

  const openAvatarPreview = (creator: Creator) => {
    setPreviewCreator(toPreviewData(creator));
    setPreviewVisible(true);
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  // Long-press creator context menu actions
  const creatorMenuActions = (creator: Creator): ActionItem[] => [
    { label: 'View Profile',    onPress: () => openCreator(creator) },
    { label: 'Subscribe',       onPress: () => router.push(`/creator/${creator.id}`) },
    { label: 'Copy Username',   onPress: () => {} },
    { label: 'Share Profile',   onPress: () => {} },
    { label: 'Mute',            onPress: () => {} },
    { label: 'Block',           destructive: true, onPress: () => {} },
  ];

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>DISCOVER</Text>
          <Text style={styles.title}>Explore</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.iconButton}
            onPress={() => router.push('/notifications')}
            accessibilityLabel="Notifications"
          >
            <Bell size={19} color={T.TEXT} />
            <View style={styles.notificationDot} />
          </Pressable>
          <Pressable style={styles.walletButton} onPress={() => router.push('/wallet')}>
            <Wallet size={16} color={T.BG} />
            <Text style={styles.walletButtonText}>{creditBalance.toLocaleString()}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.TEXT} />
        }
        contentContainerStyle={styles.scrollContent}
      >
        {/* Search */}
        <View style={styles.searchField}>
          <SearchIcon size={16} color={T.TEXT_2} />
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search creators, categories, content"
            placeholderTextColor={T.TEXT_3}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Text style={styles.clearSearch}>×</Text>
            </Pressable>
          )}
        </View>

        {/* Trending tags */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trendingRow}
        >
          {trendingSearches.map((tag) => (
            <Chip
              key={tag}
              variant="soft"
              color="default"
              size="sm"
              onPress={() => setSearch(tag)}
              style={styles.trendChip}
            >
              <Chip.Label style={styles.trendLabel}>#{tag.replaceAll(' ', '')}</Chip.Label>
            </Chip>
          ))}
        </ScrollView>

        {/* Loading */}
        {query.isLoading && <MsCatalogSkeleton />}

        {/* Error */}
        {query.isError && (
          <MsEmptyState
            title="Explore is taking a moment"
            message="We couldn't load the creator marketplace. Pull down to try again."
            actionLabel="Retry"
            onAction={() => query.refetch()}
          />
        )}

        {/* Content */}
        {!query.isLoading && !query.isError && catalog && (
          <>
            {/* Wallet banner */}
            <Pressable style={styles.creditBanner} onPress={() => router.push('/wallet')}>
              <View style={styles.creditIcon}>
                <CreditCard size={18} color={T.BG} />
              </View>
              <View style={styles.creditCopy}>
                <Text style={styles.creditEyebrow}>YOUR CREATOR WALLET</Text>
                <Text style={styles.creditBalance}>
                  {creditBalance.toLocaleString()}{' '}
                  <Text style={styles.creditUnit}>credits</Text>
                </Text>
              </View>
              <View style={styles.creditAction}>
                <Text style={styles.creditActionText}>Top up</Text>
                <CaretRight size={15} color={T.TEXT} />
              </View>
            </Pressable>

            {/* Categories — creator-focused list */}
            <View style={styles.categoryHeader}>
              <Text style={styles.sectionTitle}>Browse by category</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.categoryRow}
            >
              {CREATOR_CATEGORIES.map((category) => {
                const active = category.id === activeCategory;
                return (
                  <Chip
                    key={category.id}
                    variant={active ? 'primary' : 'soft'}
                    color="default"
                    size="sm"
                    onPress={() => setActiveCategory(category.id)}
                    style={[styles.categoryChip, active && styles.categoryChipActive]}
                  >
                    <Chip.Label
                      style={[styles.categoryLabel, active && styles.categoryLabelActive]}
                    >
                      {category.label}
                    </Chip.Label>
                  </Chip>
                );
              })}
            </ScrollView>

            {/* Featured creators */}
            {featured.length > 0 && (
              <>
                <MsSectionHeader
                  title="Featured creators"
                  actionLabel="View all"
                  onAction={() => setActiveCategory('all')}
                  style={styles.sectionHeader}
                />
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.featuredRow}
                >
                  {featured.map((creator) => (
                    <MsFeaturedCreatorCard
                      key={creator.id}
                      creator={creator}
                      onPress={() => openCreator(creator)}
                      onLongPress={() => setMenuCreator(creator)}
                      onAvatarPress={() => openAvatarPreview(creator)}
                    />
                  ))}
                </ScrollView>
              </>
            )}

            {/* Recommended */}
            {recommended.length > 0 && (
              <>
                <MsSectionHeader
                  title="Recommended for you"
                  actionLabel="See all"
                  onAction={() => setSearch('')}
                  style={styles.sectionHeader}
                />
                <View>
                  {recommended.map((creator) => (
                    <MsRecommendedCreatorRow
                      key={creator.id}
                      creator={creator}
                      onPress={() => openCreator(creator)}
                      onLongPress={() => setMenuCreator(creator)}
                      onAvatarPress={() => openAvatarPreview(creator)}
                    />
                  ))}
                </View>
              </>
            )}

            {/* Premium previews */}
            <MsSectionHeader
              title="Premium previews"
              actionLabel="Latest"
              style={styles.sectionHeader}
            />
            {previews.length > 0 ? (
              <View style={styles.previewGrid}>
                {previews.map((preview) => {
                  const creator = findCreator(catalog.creators, preview.creatorId);
                  return creator ? (
                    <MsPreviewCard
                      key={preview.id}
                      preview={preview}
                      creator={creator}
                      onPress={() => router.push(`/content/${preview.id}`)}
                      onLongPress={() => setMenuCreator(creator)}
                    />
                  ) : null;
                })}
              </View>
            ) : (
              <MsEmptyState
                title="Discover creators you'll love"
                message="Try a different category or search to find your next favourite creator."
                actionLabel="Show all"
                onAction={() => setActiveCategory('all')}
              />
            )}

            {/* Collections */}
            <MsSectionHeader
              title="Trending collections"
              actionLabel="Explore all"
              style={styles.sectionHeader}
            />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.collectionRow}
            >
              {(catalog.collections ?? []).map((collection) => (
                <MsCollectionCard
                  key={collection.id}
                  collection={collection}
                  onPress={() => setSearch(collection.title)}
                />
              ))}
            </ScrollView>

            {/* Recently joined */}
            <MsSectionHeader
              title="Recently joined"
              actionLabel="Meet the newest"
              style={styles.sectionHeader}
            />
            {visibleCreators.length > 0 ? (
              visibleCreators.slice(-3).map((creator) => (
                <MsRecommendedCreatorRow
                  key={creator.id}
                  creator={creator}
                  onPress={() => openCreator(creator)}
                  onLongPress={() => setMenuCreator(creator)}
                  onAvatarPress={() => openAvatarPreview(creator)}
                />
              ))
            ) : (
              <MsEmptyState
                title="No creators match that search"
                message="Try a trending tag or clear your filters to keep discovering."
                actionLabel="Clear search"
                onAction={() => {
                  setSearch('');
                  setActiveCategory('all');
                }}
              />
            )}

            <View style={styles.bottomSpace} />
          </>
        )}
      </ScrollView>

      {/* Creator long-press action sheet */}
      <MsActionSheet
        visible={!!menuCreator}
        title={menuCreator?.name}
        subtitle={menuCreator?.handle}
        actions={menuCreator ? creatorMenuActions(menuCreator) : []}
        onClose={() => setMenuCreator(null)}
      />

      {/* Creator avatar-tap preview card */}
      <MsCreatorPreview
        visible={previewVisible}
        creator={previewCreator}
        onClose={() => setPreviewVisible(false)}
        onViewProfile={() => {
          if (previewCreator) router.push(`/creator/${previewCreator.id}`);
        }}
        onSubscribe={() => {
          if (previewCreator) router.push(`/creator/${previewCreator.id}`);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrow: { color: T.TEXT_3, fontFamily: T.FONT.semibold, fontSize: 9, letterSpacing: 1.5 },
  title: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 28, letterSpacing: -0.8, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: T.TEXT,
  },
  walletButton: {
    height: 38,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    borderRadius: 19,
    backgroundColor: T.TEXT,
  },
  walletButtonText: { color: T.BG, fontFamily: T.FONT.semibold, fontSize: 11 },
  scrollContent: { paddingTop: 16 },
  searchField: {
    marginHorizontal: 20,
    height: 46,
    borderRadius: T.RADIUS.full,
    backgroundColor: T.SURFACE,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    gap: 9,
  },
  searchInput: {
    flex: 1,
    color: T.TEXT,
    fontFamily: T.FONT.regular,
    fontSize: 13,
    height: 44,
    paddingHorizontal: 0,
  },
  clearSearch: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 22, lineHeight: 22 },
  trendingRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 13 },
  trendChip: { backgroundColor: T.SURFACE },
  trendLabel: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
  creditBanner: {
    marginHorizontal: 20,
    backgroundColor: T.TEXT,
    minHeight: 78,
    borderRadius: T.RADIUS.lg,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  creditIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: T.BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creditCopy: { flex: 1 },
  creditEyebrow: {
    color: 'rgba(0,0,0,0.55)',
    fontFamily: T.FONT.semibold,
    fontSize: 8,
    letterSpacing: 1.1,
  },
  creditBalance: {
    color: T.BG,
    fontFamily: T.FONT.bold,
    fontSize: 22,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  creditUnit: { fontFamily: T.FONT.medium, fontSize: 11 },
  creditAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  creditActionText: { color: T.BG, fontFamily: T.FONT.semibold, fontSize: 11 },
  categoryHeader: {
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 3,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 15 },
  categoryRow: { paddingHorizontal: 20, gap: 7, paddingVertical: 11 },
  categoryChip: { backgroundColor: T.SURFACE },
  categoryChipActive: { backgroundColor: T.TEXT },
  categoryLabel: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
  categoryLabelActive: { color: T.BG },
  sectionHeader: { paddingTop: 22, paddingBottom: 11 },
  featuredRow: { gap: 12, paddingHorizontal: 20, paddingBottom: 3 },
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20 },
  collectionRow: { gap: 12, paddingHorizontal: 20 },
  bottomSpace: { height: 24 },
});
