import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Check, Lock, Play, Sparkle, Users } from 'phosphor-react-native';
import type { ContentPreview, Creator, TrendingCollection } from '@/lib/api-client-react';
import { MsAvatar } from '@/components/MsAvatar';
import { T } from '@/constants/theme';

const toneMap: Record<string, string> = {
  'mono-sand': '#343434',
  'mono-mist': '#242424',
  'mono-slate': '#1D2227',
  'mono-ink': '#151515',
  'mono-cloud': '#3B3B3B',
  'mono-charcoal': '#202020',
  'mono-stone': '#2C2A28',
  'mono-fog': '#292929',
};

function tone(gradient: string) {
  return toneMap[gradient] ?? T.SURFACE_2;
}

// ─── Creator Identity (avatar + name + handle row) ────────────────────────────

export function MsCreatorIdentity({
  creator,
  size = 42,
  onPress,
}: {
  creator: Creator;
  size?: number;
  onPress?: () => void;
}) {
  const content = (
    <View style={identityStyles.wrap}>
      <MsAvatar
        size={size}
        initials={creator.initials}
        showOnline={creator.isOnline}
      />
      <View style={identityStyles.copy}>
        <View style={identityStyles.nameRow}>
          <Text style={identityStyles.name} numberOfLines={1}>
            {creator.name}
          </Text>
          {creator.isVerified && <Check size={13} color={T.TEXT} weight="fill" />}
        </View>
        <Text style={identityStyles.handle} numberOfLines={1}>
          {creator.handle}
        </Text>
      </View>
    </View>
  );

  return onPress ? (
    <Pressable onPress={onPress} style={identityStyles.pressable}>
      {content}
    </Pressable>
  ) : (
    content
  );
}

// ─── Featured Creator Card ────────────────────────────────────────────────────

export function MsFeaturedCreatorCard({
  creator,
  onPress,
  onLongPress,
  onAvatarPress,
}: {
  creator: Creator;
  onPress: () => void;
  onLongPress: () => void;
  onAvatarPress?: () => void;
}) {
  return (
    <Pressable
      style={[featuredStyles.card, { backgroundColor: tone(creator.gradient) }]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
    >
      <View style={featuredStyles.mark}>
        <Sparkle size={14} color={T.TEXT} />
        <Text style={featuredStyles.markText}>FEATURED</Text>
      </View>

      <Pressable
        style={featuredStyles.avatarWrap}
        onPress={onAvatarPress ?? onPress}
        hitSlop={6}
      >
        <MsAvatar
          size={56}
          initials={creator.initials}
          showOnline={creator.isOnline}
        />
      </Pressable>

      <View style={featuredStyles.featuredCopy}>
        <View style={featuredStyles.nameRow}>
          <Text style={featuredStyles.name} numberOfLines={1}>
            {creator.name}
          </Text>
          {creator.isVerified && <Check size={14} color={T.TEXT} weight="fill" />}
        </View>
        <Text style={featuredStyles.handle}>
          {creator.handle} · {creator.category}
        </Text>
        <Text style={featuredStyles.bio} numberOfLines={2}>
          {creator.bio}
        </Text>
      </View>

      <View style={featuredStyles.footer}>
        <View style={featuredStyles.metric}>
          <Users size={13} color={T.TEXT_2} />
          <Text style={featuredStyles.metricText}>{creator.followers}</Text>
        </View>
        <Text style={featuredStyles.credits}>{creator.monthlyCredits} credits / mo</Text>
      </View>

      {/* Subscribe button */}
      <View style={featuredStyles.subscribeBtn}>
        <Text style={featuredStyles.subscribeBtnLabel}>Subscribe</Text>
      </View>
    </Pressable>
  );
}

// ─── Recommended Creator Row ──────────────────────────────────────────────────

export function MsRecommendedCreatorRow({
  creator,
  onPress,
  onLongPress,
  onAvatarPress,
}: {
  creator: Creator;
  onPress: () => void;
  onLongPress: () => void;
  onAvatarPress?: () => void;
}) {
  return (
    <Pressable
      style={recommendedStyles.row}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
    >
      <Pressable onPress={onAvatarPress ?? onPress} hitSlop={6}>
        <MsAvatar size={46} initials={creator.initials} showOnline={creator.isOnline} />
      </Pressable>

      <View style={recommendedStyles.info}>
        <View style={recommendedStyles.nameRow}>
          <Text style={recommendedStyles.name} numberOfLines={1}>
            {creator.name}
          </Text>
          {creator.isVerified && <Check size={12} color={T.TEXT} weight="fill" />}
        </View>
        <Text style={recommendedStyles.handle} numberOfLines={1}>
          {creator.handle}
        </Text>
      </View>

      <View style={recommendedStyles.meta}>
        <Text style={recommendedStyles.category}>{creator.category.toUpperCase()}</Text>
        <Text style={recommendedStyles.followers}>{creator.followers} followers</Text>
      </View>

      <View style={recommendedStyles.subscribeButton}>
        <Text style={recommendedStyles.subscribeLabel}>Subscribe</Text>
      </View>
    </Pressable>
  );
}

// ─── Preview Card ─────────────────────────────────────────────────────────────

export function MsPreviewCard({
  preview,
  creator,
  onPress,
  onLongPress,
}: {
  preview: ContentPreview;
  creator: Creator;
  onPress: () => void;
  onLongPress: () => void;
}) {
  return (
    <Pressable
      style={previewStyles.card}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={400}
    >
      <View style={[previewStyles.art, { backgroundColor: tone(preview.gradient) }]}>
        <View style={previewStyles.artLines}>
          <View style={previewStyles.lineWide} />
          <View style={previewStyles.lineShort} />
          <View style={previewStyles.lineWide} />
        </View>
        <View style={previewStyles.typeMark}>
          {preview.isPremium ? (
            <Lock size={13} color={T.TEXT} />
          ) : (
            <Play size={13} color={T.TEXT} weight="fill" />
          )}
          <Text style={previewStyles.typeText}>{preview.kind}</Text>
        </View>
        <View style={previewStyles.previewBadge}>
          <Text style={previewStyles.previewBadgeText}>
            {preview.isPremium ? 'PREMIUM' : 'PREVIEW'}
          </Text>
        </View>
      </View>
      <View style={previewStyles.body}>
        <Text style={previewStyles.title} numberOfLines={1}>
          {preview.title}
        </Text>
        <Text style={previewStyles.creator} numberOfLines={1}>
          {creator.name} · {preview.duration}
        </Text>
        <View style={previewStyles.footer}>
          <Text style={previewStyles.likes}>{preview.likes} likes</Text>
          <Text style={previewStyles.locked}>{preview.lockedLabel}</Text>
        </View>
      </View>
    </Pressable>
  );
}

// ─── Collection Card ──────────────────────────────────────────────────────────

export function MsCollectionCard({
  collection,
  onPress,
}: {
  collection: TrendingCollection;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[collectionStyles.card, { backgroundColor: tone(collection.gradient) }]}
      onPress={onPress}
    >
      <View style={collectionStyles.icon}>
        <Sparkle size={16} color={T.TEXT} />
      </View>
      <View style={collectionStyles.copy}>
        <Text style={collectionStyles.title}>{collection.title}</Text>
        <Text style={collectionStyles.subtitle}>{collection.subtitle}</Text>
      </View>
      <Text style={collectionStyles.count}>{collection.itemCount} items</Text>
    </Pressable>
  );
}

// ─── Catalog Skeleton ─────────────────────────────────────────────────────────

export function MsCatalogSkeleton() {
  return (
    <View style={skeletonStyles.wrap}>
      <View style={skeletonStyles.heroRow}>
        <View style={skeletonStyles.featuredSkeleton} />
        <View style={skeletonStyles.featuredSkeleton} />
      </View>
      <View style={skeletonStyles.row}>
        <View style={skeletonStyles.avatar} />
        <View style={skeletonStyles.copy} />
        <View style={skeletonStyles.button} />
      </View>
      <View style={skeletonStyles.row}>
        <View style={skeletonStyles.avatar} />
        <View style={skeletonStyles.copy} />
        <View style={skeletonStyles.button} />
      </View>
      <View style={skeletonStyles.grid}>
        <View style={skeletonStyles.preview} />
        <View style={skeletonStyles.preview} />
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const identityStyles = StyleSheet.create({
  pressable: { flex: 1 },
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  copy: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 13, flexShrink: 1 },
  handle: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 11, marginTop: 2 },
});

const featuredStyles = StyleSheet.create({
  card: {
    width: 254,
    minHeight: 260,
    borderRadius: T.RADIUS.xl,
    padding: 16,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  markText: { color: T.TEXT_2, fontFamily: T.FONT.semibold, fontSize: 9, letterSpacing: 1.2 },
  avatarWrap: { marginTop: 14 },
  featuredCopy: { marginTop: 12 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  name: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 18, letterSpacing: -0.3, flexShrink: 1 },
  handle: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 11, marginTop: 3 },
  bio: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 11, lineHeight: 17, marginTop: 9 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: T.BORDER_2,
  },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metricText: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 11 },
  credits: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 10 },
  subscribeBtn: {
    marginTop: 12,
    height: 36,
    borderRadius: T.RADIUS.sm,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeBtnLabel: { fontSize: 13, fontFamily: T.FONT.semibold, color: T.BG },
});

const recommendedStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 13, flexShrink: 1 },
  handle: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 11, marginTop: 2 },
  meta: { alignItems: 'flex-end', marginRight: 4, gap: 3 },
  category: { color: T.TEXT_3, fontFamily: T.FONT.semibold, fontSize: 9, letterSpacing: 1 },
  followers: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 10 },
  subscribeButton: {
    borderRadius: T.RADIUS.full,
    paddingHorizontal: 12,
    height: 31,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subscribeLabel: { color: T.BG, fontFamily: T.FONT.semibold, fontSize: 11 },
});

const previewStyles = StyleSheet.create({
  card: { width: 164, backgroundColor: T.SURFACE, borderRadius: T.RADIUS.lg, overflow: 'hidden' },
  art: { height: 126, padding: 12, justifyContent: 'space-between' },
  artLines: { gap: 7, marginTop: 30 },
  lineWide: { height: 5, width: '70%', backgroundColor: 'rgba(255,255,255,0.23)', borderRadius: 3 },
  lineShort: { height: 5, width: '42%', backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: 3 },
  typeMark: {
    position: 'absolute',
    left: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  typeText: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 10, textTransform: 'capitalize' },
  previewBadge: {
    position: 'absolute',
    right: 10,
    top: 10,
    backgroundColor: 'rgba(0,0,0,0.32)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  previewBadgeText: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 8, letterSpacing: 0.8 },
  body: { padding: 12 },
  title: { color: T.TEXT, fontFamily: T.FONT.semibold, fontSize: 12 },
  creator: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 10, marginTop: 4 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', gap: 5, marginTop: 12 },
  likes: { color: T.TEXT_3, fontFamily: T.FONT.regular, fontSize: 9 },
  locked: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 9, flexShrink: 1, textAlign: 'right' },
});

const collectionStyles = StyleSheet.create({
  card: {
    width: 222,
    height: 126,
    borderRadius: T.RADIUS.lg,
    padding: 14,
    justifyContent: 'space-between',
  },
  icon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { marginTop: 8 },
  title: { color: T.TEXT, fontFamily: T.FONT.bold, fontSize: 15 },
  subtitle: { color: T.TEXT_2, fontFamily: T.FONT.regular, fontSize: 10, marginTop: 3 },
  count: { color: T.TEXT_2, fontFamily: T.FONT.medium, fontSize: 10 },
});

const skeletonStyles = StyleSheet.create({
  wrap: { paddingTop: 20 },
  heroRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  featuredSkeleton: {
    width: 254,
    height: 260,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 24,
  },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: T.SURFACE_2 },
  copy: { height: 34, flex: 1, backgroundColor: T.SURFACE },
  button: { width: 80, height: 31, borderRadius: T.RADIUS.sm, backgroundColor: T.SURFACE },
  grid: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, marginTop: 22 },
  preview: { flex: 1, height: 210, borderRadius: T.RADIUS.lg, backgroundColor: T.SURFACE },
});
