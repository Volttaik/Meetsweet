import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ViewToken,
} from 'react-native';
import { Button } from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

const { width: SCREEN_W } = Dimensions.get('window');

// ─── Illustrations ─────────────────────────────────────────────────────────

const ILLUS_SIZE = 260;

function IllustrationDiscover() {
  return (
    <Svg width={ILLUS_SIZE} height={ILLUS_SIZE} viewBox="0 0 220 220">
      <Rect x="20" y="60" width="80" height="100" rx="16" fill="#111111" />
      <Circle cx="60" cy="100" r="22" fill="#222222" />
      <Circle cx="60" cy="100" r="14" fill="#444444" />
      <Rect x="34" y="128" width="52" height="8" rx="4" fill="#2A2A2A" />
      <Rect x="42" y="142" width="36" height="6" rx="3" fill="#1E1E1E" />

      <Rect x="120" y="40" width="80" height="100" rx="16" fill="#111111" />
      <Circle cx="160" cy="80" r="22" fill="#222222" />
      <Circle cx="160" cy="80" r="14" fill="#444444" />
      <Rect x="134" y="108" width="52" height="8" rx="4" fill="#2A2A2A" />
      <Rect x="142" y="122" width="36" height="6" rx="3" fill="#1E1E1E" />

      {/* Hearts */}
      <Path d="M100 50 C100 44 92 40 88 46 C84 40 76 44 76 50 C76 60 88 68 88 68 C88 68 100 60 100 50Z" fill="#FFFFFF" opacity="0.9" />
      <Path d="M155 165 C155 161 150 158 148 162 C146 158 141 161 141 165 C141 171 148 176 148 176 C148 176 155 171 155 165Z" fill="#FFFFFF" opacity="0.5" />
      <Circle cx="30" cy="44" r="3" fill="rgba(255,255,255,0.4)" />
      <Circle cx="190" cy="160" r="3" fill="rgba(255,255,255,0.4)" />
    </Svg>
  );
}

function IllustrationChat() {
  return (
    <Svg width={ILLUS_SIZE} height={ILLUS_SIZE} viewBox="0 0 220 220">
      <Rect x="20" y="50" width="130" height="48" rx="16" fill="#111111" />
      <Path d="M20 98 L8 110 L32 98Z" fill="#111111" />
      <Rect x="36" y="65" width="96" height="8" rx="4" fill="#2A2A2A" />
      <Rect x="36" y="79" width="72" height="8" rx="4" fill="#222222" />

      <Rect x="70" y="120" width="130" height="48" rx="16" fill="#FFFFFF" opacity="0.9" />
      <Path d="M200 168 L212 180 L188 168Z" fill="#FFFFFF" opacity="0.9" />
      <Rect x="86" y="135" width="96" height="8" rx="4" fill="#000000" opacity="0.25" />
      <Rect x="86" y="149" width="64" height="8" rx="4" fill="#000000" opacity="0.25" />

      {/* Lock badge */}
      <Circle cx="176" cy="76" r="24" fill="#0A0A0A" />
      <Circle cx="176" cy="76" r="20" fill="#111111" />
      <Rect x="166" y="74" width="20" height="14" rx="4" fill="#FFFFFF" />
      <Path d="M171 74 C171 68 181 68 181 74" stroke="#FFFFFF" strokeWidth="3" fill="none" />
      <Circle cx="176" cy="81" r="2" fill="#111111" />

      <Circle cx="50" cy="185" r="3" fill="rgba(255,255,255,0.3)" />
      <Circle cx="170" cy="40" r="3" fill="rgba(255,255,255,0.3)" />
    </Svg>
  );
}

function IllustrationSubscribe() {
  return (
    <Svg width={ILLUS_SIZE} height={ILLUS_SIZE} viewBox="0 0 220 220">
      <Path
        d="M60 140 L60 100 L85 120 L110 80 L135 120 L160 100 L160 140Z"
        fill="#FFFFFF"
        opacity="0.9"
      />
      <Circle cx="110" cy="110" r="8" fill="#FFFFFF" opacity="0.6" />
      <Circle cx="85" cy="122" r="5" fill="rgba(255,255,255,0.4)" />
      <Circle cx="135" cy="122" r="5" fill="rgba(255,255,255,0.4)" />

      {[0, 45, 90, 135, 180, 225, 270, 315].map((angle, i) => {
        const rad = (angle * Math.PI) / 180;
        const x1 = 110 + Math.cos(rad) * 60;
        const y1 = 110 + Math.sin(rad) * 60;
        const x2 = 110 + Math.cos(rad) * 74;
        const y2 = 110 + Math.sin(rad) * 74;
        return (
          <Path key={i} d={`M${x1} ${y1} L${x2} ${y2}`} stroke="rgba(255,255,255,0.25)" strokeWidth="2" />
        );
      })}

      {/* Unlock badge */}
      <Circle cx="165" cy="165" r="22" fill="#111111" />
      <Rect x="155" y="163" width="20" height="14" rx="4" fill="#FFFFFF" />
      <Path d="M160 163 C160 155 175 155 175 163" stroke="#FFFFFF" strokeWidth="3" fill="none" />
      <Circle cx="165" cy="170" r="2" fill="#111111" />

      <Circle cx="45" cy="70" r="4" fill="rgba(255,255,255,0.35)" />
      <Circle cx="40" cy="165" r="3" fill="rgba(255,255,255,0.25)" />
    </Svg>
  );
}

const PAGES = [
  {
    key: 'discover',
    title: 'Discover Your\nFavorite Creators',
    description: 'Explore premium creators and vibrant communities built around the content you love most.',
    Illustration: IllustrationDiscover,
  },
  {
    key: 'chat',
    title: 'Connect Privately\nWith Creators',
    description: 'Send direct messages and receive exclusive content directly from the creators you follow.',
    Illustration: IllustrationChat,
  },
  {
    key: 'subscribe',
    title: 'Subscribe &\nUnlock More',
    description: 'Subscribe to unlock premium content and directly support the creators who inspire you.',
    Illustration: IllustrationSubscribe,
  },
];

function FloatingIllustration({ children }: { children: React.ReactNode }) {
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateY.value = withRepeat(
      withSequence(
        withTiming(-12, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        withTiming(0, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      false,
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

function Dots({ count, active }: { count: number; active: number }) {
  return (
    <View style={dotStyles.row}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={[dotStyles.dot, i === active && dotStyles.dotActive]} />
      ))}
    </View>
  );
}

const dotStyles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)' },
  dotActive: { width: 28, backgroundColor: '#FFFFFF' },
});

const H_PAD = 32;
const PAGE_W = SCREEN_W - H_PAD * 2;

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const goToNext = () => {
    if (activeIndex < PAGES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
    } else {
      router.push('/register');
    }
  };

  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index != null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    [],
  );
  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;
  const isLast = activeIndex === PAGES.length - 1;

  return (
    <View style={styles.bg}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 20),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 40 : 32),
          },
        ]}
      >
        <View style={styles.header}>
          <Dots count={PAGES.length} active={activeIndex} />
          <TouchableOpacity onPress={() => router.push('/auth')} hitSlop={{ top: 12, bottom: 12, left: 16, right: 16 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        </View>

        <FlatList
          ref={flatListRef}
          data={PAGES}
          keyExtractor={(item) => item.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          style={styles.flatList}
          renderItem={({ item }) => (
            <View style={[styles.page, { width: PAGE_W }]}>
              <FloatingIllustration>
                <View style={styles.illustrationWrap}>
                  <item.Illustration />
                </View>
              </FloatingIllustration>
              <View style={styles.textBlock}>
                <Text style={styles.title}>{item.title}</Text>
                <Text style={styles.description}>{item.description}</Text>
              </View>
            </View>
          )}
          getItemLayout={(_, index) => ({
            length: PAGE_W,
            offset: PAGE_W * index,
            index,
          })}
        />

        <Button variant="primary" size="lg" onPress={goToNext} style={styles.nextBtn}>
          <Button.Label style={styles.nextBtnLabel}>
            {isLast ? 'Get Started' : 'Next'}
          </Button.Label>
        </Button>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#0A0A0A' },
  container: { flex: 1, paddingHorizontal: H_PAD, gap: 28 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  skipText: { fontSize: 16, fontFamily: 'Poppins_500Medium', color: 'rgba(255,255,255,0.45)' },
  flatList: { flex: 1, marginHorizontal: -H_PAD, paddingHorizontal: H_PAD },
  page: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 44, paddingHorizontal: 4 },
  illustrationWrap: { width: ILLUS_SIZE, height: ILLUS_SIZE, alignItems: 'center', justifyContent: 'center' },
  textBlock: { gap: 16, alignItems: 'center' },
  title: {
    fontSize: 36,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    lineHeight: 46,
    letterSpacing: -0.6,
  },
  description: {
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 26,
    paddingHorizontal: 4,
  },
  nextBtn: { backgroundColor: '#FFFFFF', borderRadius: 18, height: 60 },
  nextBtnLabel: { fontFamily: 'Poppins_600SemiBold', fontSize: 17, color: '#000000' },
});
