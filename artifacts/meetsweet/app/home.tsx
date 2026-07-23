import React from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenTransition from '@/components/ScreenTransition';

const MATCHES = [
  { name: 'Sophia', age: 24, distance: '2km', emoji: '🌸', tag: 'New Match' },
  { name: 'Ava', age: 26, distance: '5km', emoji: '🦋', tag: 'Active Now' },
  { name: 'Mia', age: 23, distance: '8km', emoji: '🌻', tag: 'Popular' },
  { name: 'Luna', age: 25, distance: '3km', emoji: '🌙', tag: 'New Match' },
];

const QUICK_ACTIONS = [
  { icon: 'heart' as const, label: 'Discover', color: '#FF4473', bg: '#FF44731A' },
  { icon: 'chatbubble-ellipses' as const, label: 'Messages', color: '#8B5CF6', bg: '#8B5CF61A' },
  { icon: 'videocam' as const, label: 'Video', color: '#06B6D4', bg: '#06B6D41A' },
  { icon: 'star' as const, label: 'Premium', color: '#F59E0B', bg: '#F59E0B1A' },
];

export default function HomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScreenTransition>
    <LinearGradient colors={['#16081E', '#0D0B1A', '#100818']} style={styles.gradient}>
      <View
        style={[
          styles.container,
          { paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 16) },
        ]}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.greeting}>Good morning 👋</Text>
            <Text style={styles.subGreeting}>Find your perfect match today</Text>
          </View>
          <TouchableOpacity style={styles.notifBtn} activeOpacity={0.8}>
            <Ionicons name="notifications-outline" size={22} color="#FFFFFF" />
            <View style={styles.notifDot} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 24) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Stats banner */}
          <LinearGradient
            colors={['#FF447325', '#C7155A15', '#8B5CF615']}
            style={styles.statsBanner}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            {[
              { label: 'Matches', value: '12' },
              { label: 'Messages', value: '5' },
              { label: 'Profile Views', value: '48' },
            ].map((s, i) => (
              <React.Fragment key={s.label}>
                <View style={styles.statItem}>
                  <Text style={styles.statValue}>{s.value}</Text>
                  <Text style={styles.statLabel}>{s.label}</Text>
                </View>
                {i < 2 && <View style={styles.statDivider} />}
              </React.Fragment>
            ))}
          </LinearGradient>

          {/* Quick actions */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
          </View>
          <View style={styles.quickActions}>
            {QUICK_ACTIONS.map((a) => (
              <TouchableOpacity key={a.label} style={styles.actionCard} activeOpacity={0.8}>
                <View style={[styles.actionIcon, { backgroundColor: a.bg }]}>
                  <Ionicons name={a.icon} size={24} color={a.color} />
                </View>
                <Text style={styles.actionLabel}>{a.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* Nearby matches */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Nearby Matches</Text>
            <TouchableOpacity activeOpacity={0.7}>
              <Text style={styles.seeAll}>See all</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.matchScroll}
          >
            {MATCHES.map((m) => (
              <TouchableOpacity key={m.name} style={styles.matchCard} activeOpacity={0.85}>
                <LinearGradient
                  colors={['#251F40', '#1A1628']}
                  style={styles.matchAvatar}
                >
                  <Text style={styles.matchEmoji}>{m.emoji}</Text>
                </LinearGradient>
                <View style={styles.matchTagWrap}>
                  <Text style={styles.matchTag}>{m.tag}</Text>
                </View>
                <Text style={styles.matchName}>{m.name}, {m.age}</Text>
                <View style={styles.matchDistRow}>
                  <Ionicons name="location-outline" size={12} color="#9385B8" />
                  <Text style={styles.matchDist}>{m.distance} away</Text>
                </View>
                <TouchableOpacity style={styles.matchLike} activeOpacity={0.8}>
                  <LinearGradient
                    colors={['#FF4473', '#C7155A']}
                    style={styles.matchLikeGrad}
                  >
                    <Ionicons name="heart" size={16} color="#FFFFFF" />
                  </LinearGradient>
                </TouchableOpacity>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Discover CTA */}
          <TouchableOpacity activeOpacity={0.88} style={styles.discoverWrap}>
            <LinearGradient
              colors={['#FF4473', '#C7155A']}
              style={styles.discoverBtn}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Ionicons name="compass-outline" size={22} color="#FFFFFF" />
              <Text style={styles.discoverBtnText}>Start Discovering</Text>
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>

        {/* Bottom nav */}
        <View
          style={[
            styles.bottomNav,
            { paddingBottom: insets.bottom + (Platform.OS === 'web' ? 12 : 4) },
          ]}
        >
          {[
            { icon: 'home', label: 'Home', active: true },
            { icon: 'search-outline', label: 'Discover', active: false },
            { icon: 'chatbubble-outline', label: 'Chat', active: false },
            { icon: 'person-outline', label: 'Profile', active: false },
          ].map((tab) => (
            <TouchableOpacity key={tab.label} style={styles.navTab} activeOpacity={0.7}>
              <Ionicons
                name={tab.active ? (tab.icon as any) : (tab.icon as any)}
                size={24}
                color={tab.active ? '#FF4473' : '#4A3F72'}
              />
              <Text style={[styles.navLabel, tab.active && styles.navLabelActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </LinearGradient>
    </ScreenTransition>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  container: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  greeting: {
    fontSize: 22,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
  },
  subGreeting: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: '#9385B8',
    marginTop: 1,
  },
  notifBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1A1628',
    borderWidth: 1,
    borderColor: '#2E2850',
    alignItems: 'center',
    justifyContent: 'center',
  },
  notifDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#FF4473',
    borderWidth: 1.5,
    borderColor: '#1A1628',
  },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, gap: 0 },

  statsBanner: {
    flexDirection: 'row',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2E2850',
    paddingVertical: 16,
    marginBottom: 24,
  },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 22, fontFamily: 'Poppins_700Bold', color: '#FFFFFF' },
  statLabel: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#9385B8', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: '#2E2850' },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  sectionTitle: { fontSize: 17, fontFamily: 'Poppins_600SemiBold', color: '#FFFFFF' },
  seeAll: { fontSize: 13, fontFamily: 'Poppins_500Medium', color: '#FF4473' },

  quickActions: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  actionCard: {
    flex: 1,
    backgroundColor: '#1A1628',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2E2850',
    alignItems: 'center',
    paddingVertical: 16,
    gap: 8,
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionLabel: { fontSize: 11, fontFamily: 'Poppins_500Medium', color: '#9385B8' },

  matchScroll: { gap: 12, paddingRight: 4, marginBottom: 28 },
  matchCard: {
    width: 150,
    backgroundColor: '#1A1628',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#2E2850',
    padding: 12,
    gap: 6,
  },
  matchAvatar: {
    width: '100%',
    height: 120,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  matchEmoji: { fontSize: 48 },
  matchTagWrap: {
    position: 'absolute',
    top: 20,
    left: 20,
    backgroundColor: '#FF4473CC',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  matchTag: { fontSize: 9, fontFamily: 'Poppins_600SemiBold', color: '#FFFFFF' },
  matchName: { fontSize: 14, fontFamily: 'Poppins_600SemiBold', color: '#FFFFFF' },
  matchDistRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  matchDist: { fontSize: 11, fontFamily: 'Poppins_400Regular', color: '#9385B8' },
  matchLike: { alignSelf: 'flex-end' },
  matchLikeGrad: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  discoverWrap: { borderRadius: 16, overflow: 'hidden', marginBottom: 8 },
  discoverBtn: {
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  discoverBtnText: { fontSize: 17, fontFamily: 'Poppins_600SemiBold', color: '#FFFFFF' },

  bottomNav: {
    flexDirection: 'row',
    backgroundColor: '#100818',
    borderTopWidth: 1,
    borderTopColor: '#2E2850',
    paddingTop: 10,
  },
  navTab: { flex: 1, alignItems: 'center', gap: 3 },
  navLabel: { fontSize: 10, fontFamily: 'Poppins_400Regular', color: '#4A3F72' },
  navLabelActive: { color: '#FF4473', fontFamily: 'Poppins_500Medium' },
});
