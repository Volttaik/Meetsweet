import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Heart, Lock, Play, ShareNetwork } from 'phosphor-react-native';
import { useGetExploreCatalog } from '@workspace/api-client-react';
import { Button, Spinner } from 'heroui-native';
import { MsAvatar } from '@/components/MsAvatar';
import { MsEmptyState } from '@/components/MsEmptyState';
import { T } from '@/constants/theme';

const tones: Record<string, string> = { 'mono-sand': '#343434', 'mono-mist': '#242424', 'mono-slate': '#1D2227', 'mono-ink': '#151515', 'mono-cloud': '#3B3B3B', 'mono-charcoal': '#202020', 'mono-stone': '#2C2A28', 'mono-fog': '#292929' };

export default function ContentViewerScreen() {
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const query = useGetExploreCatalog();
  const preview = useMemo(() => query.data?.previews.find((item) => item.id === id), [id, query.data]);
  const creator = useMemo(() => query.data?.creators.find((item) => item.id === preview?.creatorId), [preview, query.data]);

  if (query.isLoading) return <View style={styles.center}><Spinner color="default" size="lg" /></View>;
  if (query.isError || !preview || !creator) return <View style={styles.center}><MsEmptyState title="Preview unavailable" message="This drop is no longer available." actionLabel="Back to Explore" onAction={() => router.replace('/(tabs)/explore')} /></View>;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}><Pressable style={styles.iconButton} onPress={() => router.back()}><ArrowLeft size={20} color={T.TEXT} /></Pressable><Text style={styles.headerTitle}>Preview</Text><Pressable style={styles.iconButton}><ShareNetwork size={18} color={T.TEXT_2} /></Pressable></View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={[styles.art, { backgroundColor: tones[preview.gradient] ?? T.SURFACE_2 }]}><View style={styles.artGlow} /><View style={styles.artCopy}><Text style={styles.artKind}>{preview.kind.toUpperCase()} · {preview.duration}</Text><Text style={styles.artTitle}>{preview.title}</Text></View>{preview.isPremium && <View style={styles.lock}><Lock size={18} color={T.TEXT} /><Text style={styles.lockText}>PREMIUM PREVIEW</Text></View>} {!preview.isPremium && <View style={styles.play}><Play size={21} color={T.BG} fill={T.BG} /></View>}</View>
        <View style={styles.creatorRow}><Pressable style={styles.creatorPress} onPress={() => router.push(`/creator/${creator.id}`)}><MsAvatar size={44} initials={creator.initials} showOnline={creator.isOnline} /><View style={styles.creatorCopy}><Text style={styles.creatorName}>{creator.name}</Text><Text style={styles.creatorHandle}>{creator.handle} · {creator.followers} followers</Text></View></Pressable><Pressable style={styles.likeButton}><Heart size={19} color={T.TEXT} /></Pressable></View>
        <Text style={styles.description}>A closer look at what makes this creator's work worth following. Subscribe for the full drop and a growing archive of premium content.</Text>
        <View style={styles.unlockCard}><View><Text style={styles.unlockEyebrow}>{preview.isPremium ? 'UNLOCK THIS DROP' : 'DISCOVER THE FULL FEED'}</Text><Text style={styles.unlockTitle}>{preview.lockedLabel}</Text></View><Button variant="primary" size="sm" onPress={() => router.push(`/creator/${creator.id}`)}><Button.Label>{preview.isPremium ? 'Subscribe' : 'View profile'}</Button.Label></Button></View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: T.BG }, center: { flex: 1, backgroundColor: T.BG, alignItems: 'center', justifyContent: 'center' },
  header: { height: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: T.BORDER }, iconButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: T.SURFACE, alignItems: 'center', justifyContent: 'center' }, headerTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 15 },
  content: { paddingBottom: 30 }, art: { height: 390, margin: 20, borderRadius: T.RADIUS.xl, overflow: 'hidden', justifyContent: 'flex-end', padding: 20 }, artGlow: { position: 'absolute', width: 240, height: 240, borderRadius: 120, backgroundColor: 'rgba(255,255,255,0.08)', right: -50, top: 45 }, artCopy: { zIndex: 1 }, artKind: { color: T.TEXT_2, fontFamily: T.FONT.semibold, fontSize: 9, letterSpacing: 1.2 }, artTitle: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 30, letterSpacing: -0.8, marginTop: 8, maxWidth: 280 }, lock: { position: 'absolute', left: 20, top: 20, flexDirection: 'row', alignItems: 'center', gap: 7 }, lockText: { color: T.TEXT_2, fontFamily: T.FONT.semibold, fontSize: 9, letterSpacing: 1 }, play: { position: 'absolute', right: 20, bottom: 20, width: 46, height: 46, borderRadius: 23, backgroundColor: T.TEXT, alignItems: 'center', justifyContent: 'center' },
  creatorRow: { marginHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, creatorPress: { flexDirection: 'row', alignItems: 'center', gap: 11, flex: 1 }, creatorCopy: { flex: 1 }, creatorName: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 14 }, creatorHandle: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 11, marginTop: 3 }, likeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: T.SURFACE, alignItems: 'center', justifyContent: 'center' }, description: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 13, lineHeight: 21, marginHorizontal: 20, marginTop: 22 }, unlockCard: { margin: 20, marginTop: 28, padding: 16, borderRadius: T.RADIUS.lg, backgroundColor: T.SURFACE, borderWidth: 1, borderColor: T.BORDER, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }, unlockEyebrow: { color: T.TEXT_3, fontFamily: T.FONT.semibold, fontSize: 8, letterSpacing: 1 }, unlockTitle: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 13, marginTop: 5 },
});