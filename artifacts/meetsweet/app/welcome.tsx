import React, { useEffect } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const HIGHLIGHTS = [
  { text: 'Exclusive creator content & communities' },
  { text: 'Private messaging with your favorite creators' },
  { text: 'Subscribe & directly support creators you love' },
];

function FadeUp({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const opacity = useSharedValue(0);
  const translateY = useSharedValue(24);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 480, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 480, easing: Easing.out(Easing.cubic) }));
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

export default function WelcomeScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.bg}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 28),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 40 : 32),
          },
        ]}
      >
        {/* Logo — no border, no background */}
        <FadeUp delay={0}>
          <View style={styles.logoRow}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.logo}
              resizeMode="contain"
              tintColor="#FFFFFF"
            />
            <Text style={styles.logoText}>MeetSweet</Text>
          </View>
        </FadeUp>

        {/* Hero */}
        <FadeUp delay={100}>
          <View style={styles.hero}>
            <Text style={styles.headline}>Where creators{'\n'}meet their community</Text>
            <Text style={styles.description}>
              The premium platform connecting fans and creators through exclusive content, private chats, and meaningful subscriptions.
            </Text>

            <View style={styles.highlights}>
              {HIGHLIGHTS.map((h, i) => (
                <View key={i} style={styles.highlightRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.highlightText}>{h.text}</Text>
                </View>
              ))}
            </View>
          </View>
        </FadeUp>

        {/* Actions */}
        <View style={styles.actions}>
          <FadeUp delay={200}>
            <Button
              variant="primary"
              size="lg"
              onPress={() => router.push('/onboarding')}
              style={styles.primaryBtn}
            >
              <Button.Label style={styles.primaryBtnLabel}>Create Account</Button.Label>
            </Button>
          </FadeUp>

          <FadeUp delay={280}>
            <Button
              variant="outline"
              size="lg"
              onPress={() => router.push('/auth')}
              style={styles.outlineBtn}
            >
              <Button.Label style={styles.outlineBtnLabel}>Log In</Button.Label>
            </Button>
          </FadeUp>

          <FadeUp delay={340}>
            <Text style={styles.terms}>
              By continuing you agree to our{' '}
              <Text style={styles.termsLink}>Terms</Text>
              {' '}and{' '}
              <Text style={styles.termsLink}>Privacy Policy</Text>
            </Text>
          </FadeUp>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  container: {
    flex: 1,
    paddingHorizontal: 28,
    justifyContent: 'space-between',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: { width: 28, height: 28 },
  logoText: {
    fontSize: 18,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },
  hero: {
    gap: 20,
    paddingVertical: 8,
  },
  headline: {
    fontSize: 42,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    lineHeight: 52,
    letterSpacing: -1,
  },
  description: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 24,
  },
  highlights: {
    gap: 10,
    marginTop: 4,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  highlightText: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },
  actions: {
    gap: 12,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    height: 56,
  },
  primaryBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#000000',
  },
  outlineBtn: {
    borderRadius: 16,
    height: 56,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  outlineBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  terms: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
    lineHeight: 18,
    marginTop: 4,
  },
  termsLink: {
    color: 'rgba(255,255,255,0.6)',
  },
});
