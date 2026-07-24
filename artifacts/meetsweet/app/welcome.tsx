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
  const translateY = useSharedValue(28);

  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(0, { duration: 520, easing: Easing.out(Easing.cubic) }));
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
            paddingTop: insets.top + (Platform.OS === 'web' ? 72 : 32),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 40 : 36),
          },
        ]}
      >
        {/* Logo */}
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
          <FadeUp delay={220}>
            <Button
              variant="primary"
              size="lg"
              onPress={() => router.push('/onboarding')}
              style={styles.primaryBtn}
            >
              <Button.Label style={styles.primaryBtnLabel}>Get Started</Button.Label>
            </Button>
          </FadeUp>

          <FadeUp delay={300}>
            <Button
              variant="outline"
              size="lg"
              onPress={() => router.push('/auth')}
              style={styles.outlineBtn}
            >
              <Button.Label style={styles.outlineBtnLabel}>Log In</Button.Label>
            </Button>
          </FadeUp>

          <FadeUp delay={380}>
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
    paddingHorizontal: 32,
    justifyContent: 'space-between',
  },
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logo: { width: 40, height: 40 },
  logoText: {
    fontSize: 22,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.4,
  },
  hero: {
    gap: 22,
    paddingVertical: 8,
  },
  headline: {
    fontSize: 44,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    lineHeight: 54,
    letterSpacing: -1.2,
  },
  description: {
    fontSize: 16,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 26,
  },
  highlights: {
    gap: 12,
    marginTop: 4,
  },
  highlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  bullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  highlightText: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.6)',
    flex: 1,
  },
  actions: {
    gap: 14,
  },
  primaryBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 52,
  },
  primaryBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#000000',
  },
  outlineBtn: {
    borderRadius: 12,
    height: 52,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  outlineBtnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  terms: {
    fontSize: 13,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.25)',
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 2,
  },
  termsLink: {
    color: 'rgba(255,255,255,0.55)',
  },
});
