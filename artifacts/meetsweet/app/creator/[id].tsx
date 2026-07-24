import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Check, CaretRight, Lock, Play, Sparkle, Users } from 'phosphor-react-native';
import { BottomSheet, Button, Spinner } from 'heroui-native';
import { useGetExploreCatalog } from '@workspace/api-client-react';
import { MsAvatar } from '@/components/MsAvatar';
import { MsPreviewCard } from '@/components/MsExploreVisual';
import { MsEmptyState } from '@/components/MsEmptyState';
import { T } from '@/constants/theme';

export default function CreatorProfileScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useGetExploreCatalog();
  const [sheetOpen, setSheetOpen] = useState(false);
  const creator = useMemo(() => query.data?.creators.find((item) => item.id === id), [id, query.data]);
  const creatorPreviews = query.data?.previews.filter((item) => item.creatorId === id) ?? [];
  const canSubscribe = Boolean(creator && query.data && query.data.creditBalance >= creator.monthlyCredits);

  if (query.isLoading) {
    return <View style={styles.center}><Spinner color="default" size="lg" /></View>;
  }

  if (query.isError || !creator) {
    return (
      <View style={styles.center}>
        <MsEmptyState title="Creator not found" message="This profile may have moved. Head back to Explore to keep discovering." actionLabel="Back to Explore" onAction={() => router.replace('/(tabs)/explore')} />
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Back"><ArrowLeft size={20} color={T.TEXT} /></Pressable>
        <Text style={styles.headerTitle}>Creator profile</Text>
        <Pressable style={styles.moreButton}><Sparkle size={17} color={T.TEXT_2} /></Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.profileHero}>
          <View style={styles.avatarWrap}><MsAvatar size={84} initials={creator.initials} showOnline={creator.isOnline} /></View>
          <View style={styles.nameRow}><Text style={styles.name}>{creator.name}</Text>{creator.isVerified && <Check size={16} color={T.TEXT} />}</View>
          <Text style={styles.handle}>{creator.handle} · {creator.category}</Text>
          <Text style={styles.bio}>{creator.bio}</Text>
          <View style={styles.metrics}>
            <View><Text style={styles.metricValue}>{creator.followers}</Text><Text style={styles.metricLabel}>Followers</Text></View>
            <View style={styles.metricDivider} />
            <View><Text style={styles.metricValue}>{creator.monthlyCredits}</Text><Text style={styles.metricLabel}>Credits / mo</Text></View>
            <View style={styles.metricDivider} />
            <View><Text style={styles.metricValue}>{creatorPreviews.length}</Text><Text style={styles.metricLabel}>Previews</Text></View>
          </View>
          <Button variant="primary" size="lg" onPress={() => setSheetOpen(true)} style={styles.subscribeButton}>
            <Button.Label>{canSubscribe ? `Subscribe · ${creator.monthlyCredits} credits` : 'Get more credits to subscribe'}</Button.Label>
          </Button>
        </View>
        <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>Latest from {creator.name.split(' ')[0]}</Text><Text style={styles.sectionMeta}>{creatorPreviews.length} drops</Text></View>
        <View style={styles.previewGrid}>
          {creatorPreviews.map((preview) => <MsPreviewCard key={preview.id} preview={preview} creator={creator} onPress={() => router.push(`/content/${preview.id}`)} onLongPress={() => undefined} />)}
        </View>
        <View style={styles.aboutCard}>
          <Users size={18} color={T.TEXT_2} />
          <View style={styles.aboutCopy}><Text style={styles.aboutTitle}>A closer connection</Text><Text style={styles.aboutText}>Subscribe for the full feed, private drops, and monthly creator notes.</Text></View>
          <CaretRight size={17} color={T.TEXT_3} />
        </View>
      </ScrollView>
      <BottomSheet isOpen={sheetOpen} onOpenChange={setSheetOpen}>
        <BottomSheet.Portal>
          <BottomSheet.Overlay />
          <BottomSheet.Content>
            <View style={styles.sheetContent}>
              <BottomSheet.Title style={styles.sheetTitle}>{canSubscribe ? `Subscribe to ${creator.name}` : 'More credits needed'}</BottomSheet.Title>
              <BottomSheet.Description style={styles.sheetDescription}>
                {canSubscribe ? `${creator.monthlyCredits} credits unlock this creator's complete premium feed. Your balance will update after confirmation.` : `You need ${creator.monthlyCredits - (query.data?.creditBalance ?? 0)} more credits to subscribe.`}
              </BottomSheet.Description>
              <Button variant="primary" size="lg" onPress={() => { setSheetOpen(false); if (!canSubscribe) router.push('/wallet'); }} style={styles.sheetButton}>
                <Button.Label>{canSubscribe ? 'Confirm subscription' : 'Open wallet'}</Button.Label>
              </Button>
              <Button variant="outline" size="lg" onPress={() => setSheetOpen(false)} style={styles.sheetButton}><Button.Label>Not now</Button.Label></Button>
            </View>
          </BottomSheet.Content>
        </BottomSheet.Portal>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG },
  center: { flex: 1, backgroundColor: T.BG, alignItems: 'center', justifyContent: 'center' },
  header: { height: 62, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: T.BORDER },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: T.SURFACE, alignItems: 'center', justifyContent: 'center' },
  moreButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 15 },
  content: { paddingBottom: 35 },
  profileHero: { alignItems: 'center', paddingHorizontal: 26, paddingTop: 28 },
  avatarWrap: { marginBottom: 14 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 24, letterSpacing: -0.6 },
  handle: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 12, marginTop: 4 },
  bio: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 14, maxWidth: 320 },
  metrics: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginTop: 25, paddingVertical: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: T.BORDER },
  metricValue: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 16, textAlign: 'center' },
  metricLabel: { color: T.TEXT_3, fontFamily: T.FONT.medium, fontSize: 9, textAlign: 'center', marginTop: 3, letterSpacing: 0.3 },
  metricDivider: { width: 1, height: 24, backgroundColor: T.BORDER_2 },
  subscribeButton: { width: '100%', marginTop: 18 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 28, paddingBottom: 12 },
  sectionTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 15 },
  sectionMeta: { color: T.TEXT_3, fontFamily: T.FONT.medium, fontSize: 10 },
  previewGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, paddingHorizontal: 20 },
  aboutCard: { flexDirection: 'row', alignItems: 'center', gap: 12, margin: 20, padding: 16, borderRadius: T.RADIUS.lg, backgroundColor: T.SURFACE, borderWidth: 1, borderColor: T.BORDER },
  aboutCopy: { flex: 1 }, aboutTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 12 }, aboutText: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 11, lineHeight: 17, marginTop: 3 },
  sheetContent: { backgroundColor: T.SURFACE, padding: 22, gap: 11 }, sheetTitle: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 21 }, sheetDescription: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 13, lineHeight: 20, marginBottom: 7 }, sheetButton: { width: '100%' },
});