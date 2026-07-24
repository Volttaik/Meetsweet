import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'phosphor-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';

const FEATURES = [
  { emoji: '💎', title: 'Exclusive Content',  desc: 'Share premium content with paying subscribers only' },
  { emoji: '📱', title: 'Subscriptions',       desc: 'Earn monthly recurring revenue from your fans' },
  { emoji: '🔒', title: 'Private Posts',       desc: 'Posts only your subscribers can access and view' },
  { emoji: '💬', title: 'Private Messaging',   desc: 'Chat directly and privately with your community' },
  { emoji: '📊', title: 'Creator Analytics',   desc: 'Deep audience insights and growth tracking tools' },
  { emoji: '💰', title: 'Monthly Earnings',    desc: 'Transparent dashboard with automated monthly payouts' },
  { emoji: '👥', title: 'Audience Insights',   desc: 'Understand your fans with demographic data' },
  { emoji: '🏧', title: 'Withdrawal System',   desc: 'Withdraw to bank, card, or crypto wallet instantly' },
];

function FeatureCard({ emoji, title, desc }: { emoji: string; title: string; desc: string }) {
  return (
    <View style={styles.featureCard}>
      <Text style={styles.featureEmoji}>{emoji}</Text>
      <Text style={styles.featureTitle}>{title}</Text>
      <Text style={styles.featureDesc}>{desc}</Text>
    </View>
  );
}

export default function BecomeCreatorScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bg, { paddingTop: insets.top + 8 }]}>
      {/* Drag handle */}
      <View style={styles.handle} />

      {/* Close button */}
      <View style={styles.topBar}>
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.closeBtn}
          activeOpacity={0.7}
        >
          <X size={18} color={T.TEXT} />
        </TouchableOpacity>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
      >
        {/* Hero */}
        <View style={styles.hero}>
          <Text style={styles.heroIcon}>✦</Text>
          <Text style={styles.heroTitle}>Become a Creator</Text>
          <Text style={styles.heroSubtitle}>
            Turn your passion into income. Join thousands of creators already
            earning on MeetSweet.
          </Text>
        </View>

        {/* Stats bar */}
        <View style={styles.statsBar}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>50K+</Text>
            <Text style={styles.statLabel}>Creators</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>$2M+</Text>
            <Text style={styles.statLabel}>Paid Out</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>4.9★</Text>
            <Text style={styles.statLabel}>Creator Rating</Text>
          </View>
        </View>

        {/* Features */}
        <Text style={styles.featuresHeading}>Everything you need to succeed</Text>
        <View style={styles.featureGrid}>
          {FEATURES.map((f) => (
            <FeatureCard key={f.title} {...f} />
          ))}
        </View>

        {/* CTAs */}
        <View style={styles.ctaSection}>
          <TouchableOpacity style={styles.primaryBtn} activeOpacity={0.85}>
            <Text style={styles.primaryBtnLabel}>Become a Creator</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.back()}
            activeOpacity={0.7}
          >
            <Text style={styles.secondaryBtnLabel}>Maybe Later</Text>
          </TouchableOpacity>
          <Text style={styles.disclaimer}>
            Free to sign up · Earn 80% of every subscription
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: T.BG },

  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: T.BORDER_2,
    alignSelf: 'center',
    marginBottom: 6,
  },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },

  scrollContent: { paddingTop: 8 },

  hero: {
    alignItems: 'center',
    paddingHorizontal: 32,
    paddingVertical: 28,
    gap: 12,
  },
  heroIcon: {
    fontSize: 52,
    lineHeight: 60,
    marginBottom: 4,
  },
  heroTitle: {
    fontSize: 28,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    textAlign: 'center',
    letterSpacing: -0.6,
  },
  heroSubtitle: {
    fontSize: 15,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    textAlign: 'center',
    lineHeight: 23,
  },

  statsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 20,
    padding: 20,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    marginBottom: 8,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 18, fontFamily: T.FONT.bold, color: T.TEXT, letterSpacing: -0.3 },
  statLabel: { fontSize: 11, fontFamily: T.FONT.regular, color: T.TEXT_2, marginTop: 2 },
  statDivider: { width: 1, height: 32, backgroundColor: T.BORDER_2 },

  featuresHeading: {
    fontSize: 15,
    fontFamily: T.FONT.semibold,
    color: T.TEXT_2,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 16,
  },

  featureGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 8,
  },
  featureCard: {
    width: '47%',
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    padding: 16,
    gap: 6,
  },
  featureEmoji: { fontSize: 24, lineHeight: 30 },
  featureTitle: {
    fontSize: 13,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
    lineHeight: 18,
  },
  featureDesc: {
    fontSize: 11,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    lineHeight: 16,
  },

  ctaSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    gap: 12,
    alignItems: 'center',
  },
  primaryBtn: {
    width: '100%',
    height: 50,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.TEXT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnLabel: {
    fontSize: 15,
    fontFamily: T.FONT.semibold,
    color: T.BG,
  },
  secondaryBtn: {
    width: '100%',
    height: 46,
    borderRadius: T.RADIUS.md,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnLabel: {
    fontSize: 15,
    fontFamily: T.FONT.medium,
    color: T.TEXT_2,
  },
  disclaimer: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    textAlign: 'center',
  },
});
