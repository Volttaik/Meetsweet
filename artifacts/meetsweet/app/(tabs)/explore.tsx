import React, { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Bell, ChevronRight, CreditCard, Search as SearchIcon, WalletCards } from 'lucide-react-native';
import { useGetExploreCatalog, type Creator } from '@workspace/api-client-react';
import { BottomSheet, Button, Chip, Input } from 'heroui-native';
import { MsCatalogSkeleton, MsCollectionCard, MsFeaturedCreatorCard, MsPreviewCard, MsRecommendedCreatorRow } from '@/components/MsExploreVisual';
import { MsEmptyState } from '@/components/MsEmptyState';
import { MsSectionHeader } from '@/components/MsSectionHeader';
import { T } from '@/constants/theme';

function findCreator(creators: Creator[], id: string) {
  return creators.find((creator) => creator.id === id);
}

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [menuCreator, setMenuCreator] = useState<Creator | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const query = useGetExploreCatalog();
  const catalog = query.data;
  const creators = catalog?.creators ?? [];
  const categories = catalog?.categories ?? [];
  const previewsData = catalog?.previews ?? [];
  const featuredCreatorIds = catalog?.featuredCreatorIds ?? [];
  const recommendedCreatorIds = catalog?.recommendedCreatorIds ?? [];
  const trendingSearches = catalog?.trendingSearches ?? ['slow living', 'new creators', 'exclusive'];
  const creditBalance = Number(catalog?.creditBalance ?? 0);

  const visibleCreators = useMemo(() => {
     if (!catalog) return [];
    const needle = search.trim().toLowerCase();
     return creators.filter((creator) => {
       const category = String(creator.category ?? '');
       const categoryMatch = activeCategory === 'all' || category.toLowerCase() === activeCategory;
       const searchMatch = !needle || `${creator.name ?? ''} ${creator.handle ?? ''} ${creator.bio ?? ''} ${category}`.toLowerCase().includes(needle);
      return categoryMatch && searchMatch;
    });
   }, [activeCategory, catalog, creators, search]);

  const featured = featuredCreatorIds.map((id) => findCreator(creators, id)).filter(Boolean) as Creator[];
  const recommended = recommendedCreatorIds.map((id) => findCreator(creators, id)).filter(Boolean) as Creator[];
  const previews = previewsData.filter((preview) => {
    const creator = findCreator(creators, preview.creatorId);
    return creator && (activeCategory === 'all' || String(creator.category ?? '').toLowerCase() === activeCategory);
  });

  const openCreator = (creator: Creator) => router.push(`/creator/${creator.id}`);
  const openMenu = (creator: Creator) => {
    setMenuCreator(creator);
    setSheetOpen(true);
  };
  const refresh = async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>DISCOVER</Text>
          <Text style={styles.title}>Explore</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => router.push('/notifications')} accessibilityLabel="Notifications">
            <Bell size={19} color={T.TEXT} strokeWidth={1.7} />
            <View style={styles.notificationDot} />
          </Pressable>
          <Pressable style={styles.walletButton} onPress={() => router.push('/wallet')}>
            <WalletCards size={16} color={T.TEXT} strokeWidth={1.7} />
            <Text style={styles.walletButtonText}>{creditBalance.toLocaleString()}</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={T.TEXT} />}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.searchField}>
          <SearchIcon size={16} color={T.TEXT_2} strokeWidth={1.7} />
          <Input
            value={search}
            onChangeText={setSearch}
            placeholder="Search creators, tags, content"
            placeholderTextColor={T.TEXT_3}
            style={styles.searchInput}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch('')} hitSlop={10}>
              <Text style={styles.clearSearch}>×</Text>
            </Pressable>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trendingRow}>
           {trendingSearches.map((tag) => (
            <Chip key={tag} variant="soft" color="default" size="sm" onPress={() => setSearch(tag)} style={styles.trendChip}>
              <Chip.Label style={styles.trendLabel}>#{tag.replaceAll(' ', '')}</Chip.Label>
            </Chip>
          ))}
        </ScrollView>

        {query.isLoading && <MsCatalogSkeleton />}
        {query.isError && (
          <MsEmptyState title="Explore is taking a moment" message="We couldn't load the creator marketplace. Pull down to try again." actionLabel="Retry" onAction={() => query.refetch()} />
        )}
        {!query.isLoading && !query.isError && catalog && (
          <>
            <Pressable style={styles.creditBanner} onPress={() => router.push('/wallet')}>
              <View style={styles.creditIcon}><CreditCard size={18} color={T.BG} strokeWidth={1.8} /></View>
              <View style={styles.creditCopy}>
                <Text style={styles.creditEyebrow}>YOUR CREATOR WALLET</Text>
                <Text style={styles.creditBalance}>{creditBalance.toLocaleString()} <Text style={styles.creditUnit}>credits</Text></Text>
              </View>
              <View style={styles.creditAction}><Text style={styles.creditActionText}>Top up</Text><ChevronRight size={15} color={T.TEXT} /></View>
            </Pressable>

            <View style={styles.categoryHeader}>
              <Text style={styles.sectionTitle}>Browse by category</Text>
                  <SearchIcon size={15} color={T.TEXT_3} strokeWidth={1.6} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>
              {categories.map((category) => {
                const active = category.id === activeCategory;
                return (
                  <Chip key={category.id} variant={active ? 'primary' : 'soft'} color="default" size="sm" onPress={() => setActiveCategory(category.id)} style={[styles.categoryChip, active && styles.categoryChipActive]}>
                    <Chip.Label style={[styles.categoryLabel, active && styles.categoryLabelActive]}>{category.label} <Text style={active ? styles.categoryCountActive : styles.categoryCount}>· {category.count}</Text></Chip.Label>
                  </Chip>
                );
              })}
            </ScrollView>

            {featured && featured.length > 0 && (
              <>
                <MsSectionHeader title="Featured creators" actionLabel="View all" onAction={() => setActiveCategory('all')} style={styles.sectionHeader} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featuredRow}>
                  {featured.map((creator) => <MsFeaturedCreatorCard key={creator.id} creator={creator} onPress={() => openCreator(creator)} onLongPress={() => openMenu(creator)} />)}
                </ScrollView>
              </>
            )}

            {recommended && recommended.length > 0 && (
              <>
                <MsSectionHeader title="Recommended for you" actionLabel="See all" onAction={() => setSearch('')} style={styles.sectionHeader} />
                <View>{recommended.map((creator) => <MsRecommendedCreatorRow key={creator.id} creator={creator} onPress={() => openCreator(creator)} onLongPress={() => openMenu(creator)} />)}</View>
              </>
            )}

            <MsSectionHeader title="Premium previews" actionLabel="Latest" style={styles.sectionHeader} />
            {previews && previews.length > 0 ? (
              <View style={styles.previewGrid}>
                {previews.map((preview) => {
                  const creator = findCreator(catalog.creators, preview.creatorId);
                  return creator ? <MsPreviewCard key={preview.id} preview={preview} creator={creator} onPress={() => router.push(`/content/${preview.id}`)} onLongPress={() => openMenu(creator)} /> : null;
                })}
              </View>
            ) : (
              <MsEmptyState title="Nothing in this category yet" message="Try another category or search for a different creator." actionLabel="Show all" onAction={() => setActiveCategory('all')} />
            )}

            <MsSectionHeader title="Trending collections" actionLabel="Explore all" style={styles.sectionHeader} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.collectionRow}>
              {(catalog.collections ?? []).map((collection) => <MsCollectionCard key={collection.id} collection={collection} onPress={() => setSearch(collection.title)} />)}
            </ScrollView>

            <MsSectionHeader title="Recently joined" actionLabel="Meet the newest" style={styles.sectionHeader} />
            {visibleCreators.slice(-3).map((creator) => <MsRecommendedCreatorRow key={creator.id} creator={creator} onPress={() => openCreator(creator)} onLongPress={() => openMenu(creator)} />)}
            {visibleCreators.length === 0 && <MsEmptyState title="No creators match that search" message="Try a trending search or clear your filters." actionLabel="Clear search" onAction={() => { setSearch(''); setActiveCategory('all'); }} />}
            <View style={styles.bottomSpace} />
          </>
        )}
      </ScrollView>

      <BottomSheet isOpen={sheetOpen} onOpenChange={setSheetOpen}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content>
            <View style={styles.sheetContent}>
            <BottomSheet.Title style={styles.sheetTitle}>{menuCreator?.name}</BottomSheet.Title>
            <BottomSheet.Description style={styles.sheetDescription}>Choose what you'd like to do with this creator.</BottomSheet.Description>
            <Button variant="primary" size="lg" onPress={() => { setSheetOpen(false); if (menuCreator) openCreator(menuCreator); }} style={styles.sheetButton}>
              <Button.Label>View creator profile</Button.Label>
            </Button>
            <Button variant="outline" size="lg" onPress={() => setSheetOpen(false)} style={styles.sheetButton}>
              <Button.Label>Save for later</Button.Label>
            </Button>
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },
  header: { minHeight: 72, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { color: T.TEXT_3, fontFamily: T.FONT.semibold, fontSize: 9, letterSpacing: 1.5 },
  title: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 28, letterSpacing: -0.8, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.SURFACE, alignItems: 'center', justifyContent: 'center' },
  notificationDot: { position: 'absolute', top: 8, right: 9, width: 5, height: 5, borderRadius: 3, backgroundColor: T.TEXT },
  walletButton: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, borderRadius: 19, backgroundColor: T.TEXT },
  walletButtonText: { color: T.BG, fontFamily: T.FONT.semibold, fontSize: 11 },
  scrollContent: { paddingTop: 16 },
  searchField: { marginHorizontal: 20, height: 46, borderRadius: T.RADIUS.full, backgroundColor: T.SURFACE, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, gap: 9 },
  searchInput: { flex: 1, color: T.TEXT, fontFamily: T.FONT.regular, fontSize: 13, height: 44, paddingHorizontal: 0 },
  clearSearch: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 22, lineHeight: 22 },
  trendingRow: { gap: 8, paddingHorizontal: 20, paddingVertical: 13 },
  trendChip: { backgroundColor: T.SURFACE },
  trendLabel: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
  creditBanner: { marginHorizontal: 20, backgroundColor: T.TEXT, minHeight: 78, borderRadius: T.RADIUS.lg, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  creditIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.BG, alignItems: 'center', justifyContent: 'center' },
  creditCopy: { flex: 1 },
  creditEyebrow: { color: 'rgba(0,0,0,0.55)', fontFamily: T.FONT.semibold, fontSize: 8, letterSpacing: 1.1 },
  creditBalance: { color: T.BG, fontFamily: T.FONT.bold, fontSize: 22, letterSpacing: -0.5, marginTop: 2 },
  creditUnit: { fontFamily: T.FONT.medium, fontSize: 11 },
  creditAction: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  creditActionText: { color: T.BG, fontFamily: T.FONT.semibold, fontSize: 11 },
  categoryHeader: { paddingHorizontal: 20, paddingTop: 25, paddingBottom: 3, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 15 },
  categoryRow: { paddingHorizontal: 20, gap: 7, paddingVertical: 11 },
  categoryChip: { backgroundColor: T.SURFACE },
  categoryChipActive: { backgroundColor: T.TEXT },
  categoryLabel: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
  categoryLabelActive: { color: T.BG },
  categoryCount: { color: T.TEXT_3, fontSize: 10 },
  categoryCountActive: { color: 'rgba(0,0,0,0.45)', fontSize: 10 },
  sectionHeader: { paddingTop: 22, paddingBottom: 11 },
  featuredRow: { gap: 12, paddingHorizontal: 20, paddingBottom: 3 },
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20 },
  collectionRow: { gap: 12, paddingHorizontal: 20 },
  bottomSpace: { height: 24 },
  sheetContent: { backgroundColor: T.SURFACE, padding: 22, gap: 11 },
  sheetTitle: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 21 },
  sheetDescription: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 13, marginBottom: 7 },
  sheetButton: { width: '100%' },
});