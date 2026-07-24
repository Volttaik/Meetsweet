import React from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, TrendingUp, Users, DollarSign, BarChart2 } from 'lucide-react-native';
import { router } from 'expo-router';
import { T } from '@/constants/theme';
import { MsSkeletonCard } from '@/components/MsSkeletonCard';

type StatCard = {
  Icon: React.ComponentType<{ size: number; color: string; strokeWidth: number }>;
  label: string;
  value: string;
  change: string;
  positive: boolean;
};

const STATS: StatCard[] = [
  { Icon: DollarSign, label: 'This Month',   value: '$0.00',  change: '—',     positive: true  },
  { Icon: Users,      label: 'Subscribers',  value: '0',      change: '—',     positive: true  },
  { Icon: TrendingUp, label: 'Profile Views',value: '0',      change: '—',     positive: true  },
  { Icon: BarChart2,  label: 'Engagement',   value: '0%',     change: '—',     positive: true  },
];

function StatCard({ Icon, label, value, change, positive }: StatCard) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>
        <Icon size={18} color={T.TEXT_2} strokeWidth={1.8} />
      </View>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={[styles.statChange, { color: positive ? T.SUCCESS : T.ERROR }]}>
        {change}
      </Text>
    </View>
  );
}

export default function CreatorDashboardScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bg, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          activeOpacity={0.7}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <ArrowLeft size={22} color={T.TEXT} strokeWidth={2} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Creator Dashboard</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}>

        {/* Welcome banner */}
        <View style={styles.banner}>
          <Text style={styles.bannerEmoji}>✦</Text>
          <Text style={styles.bannerTitle}>Creator Hub</Text>
          <Text style={styles.bannerSubtitle}>
            Your creator tools and analytics are being set up.{'\n'}
            Check back soon — this will be your command center.
          </Text>
        </View>

        {/* Stats grid */}
        <Text style={styles.sectionTitle}>Overview</Text>
        <View style={styles.statsGrid}>
          {STATS.map((s) => <StatCard key={s.label} {...s} />)}
        </View>

        {/* Placeholder sections */}
        <Text style={styles.sectionTitle}>Recent Activity</Text>
        <View style={styles.placeholderSection}>
          <MsSkeletonCard height={60} style={{ marginBottom: 10 }} />
          <MsSkeletonCard height={60} style={{ marginBottom: 10 }} />
          <MsSkeletonCard height={60} />
        </View>

        <Text style={styles.sectionTitle}>Content Performance</Text>
        <View style={styles.placeholderSection}>
          <MsSkeletonCard height={160} />
        </View>

        {/* Coming soon label */}
        <View style={styles.comingSoon}>
          <Text style={styles.comingSoonText}>
            Full creator tools — analytics, subscriber management, content scheduling,
            and earnings withdrawals — are coming soon.
          </Text>
        </View>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: T.BG },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: T.BORDER,
    gap: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: T.RADIUS.md,
    backgroundColor: T.SURFACE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 18,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.3,
    textAlign: 'center',
  },

  scrollContent: { paddingTop: 8 },

  banner: {
    margin: 20,
    padding: 24,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.xl,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    alignItems: 'center',
    gap: 10,
  },
  bannerEmoji: { fontSize: 36, lineHeight: 44 },
  bannerTitle: {
    fontSize: 20,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.4,
  },
  bannerSubtitle: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    textAlign: 'center',
    lineHeight: 22,
  },

  sectionTitle: {
    fontSize: 15,
    fontFamily: T.FONT.semibold,
    color: T.TEXT,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    letterSpacing: -0.2,
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 12,
    marginBottom: 8,
  },
  statCard: {
    width: '47%',
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
    padding: 16,
    gap: 4,
  },
  statIcon: {
    width: 34,
    height: 34,
    borderRadius: T.RADIUS.sm,
    backgroundColor: T.SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  statLabel: {
    fontSize: 12,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
  },
  statValue: {
    fontSize: 20,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.5,
    marginTop: 2,
  },
  statChange: {
    fontSize: 12,
    fontFamily: T.FONT.medium,
    marginTop: 2,
  },

  placeholderSection: {
    marginHorizontal: 20,
    marginBottom: 8,
  },

  comingSoon: {
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    backgroundColor: T.SURFACE,
    borderRadius: T.RADIUS.lg,
    borderWidth: 1,
    borderColor: T.BORDER_2,
  },
  comingSoonText: {
    fontSize: 13,
    fontFamily: T.FONT.regular,
    color: T.TEXT_3,
    textAlign: 'center',
    lineHeight: 20,
  },
});
