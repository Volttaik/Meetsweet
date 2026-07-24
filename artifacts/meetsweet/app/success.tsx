import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { CheckCircle } from 'lucide-react-native';

const AUTO_NAVIGATE_MS = 2200;

export default function SuccessScreen() {
  const insets = useSafeAreaInsets();

  const iconOpacity = useSharedValue(0);
  const iconY = useSharedValue(16);
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(12);
  const subtitleOpacity = useSharedValue(0);

  useEffect(() => {
    // Icon fades + slides up
    iconOpacity.value = withTiming(1, { duration: 380, easing: Easing.out(Easing.cubic) });
    iconY.value = withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) });
    // Title follows
    titleOpacity.value = withDelay(260, withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) }));
    titleY.value = withDelay(260, withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) }));
    // Subtitle
    subtitleOpacity.value = withDelay(440, withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));

    // Auto-navigate to login
    const t = setTimeout(() => router.replace('/auth'), AUTO_NAVIGATE_MS);
    return () => clearTimeout(t);
  }, []);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ translateY: iconY.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));

  return (
    <View style={styles.bg}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 80 : 40),
            paddingBottom: insets.bottom + 48,
          },
        ]}
      >
        <Animated.View style={[styles.iconWrap, iconStyle]}>
          <CheckCircle size={64} color="#FFFFFF" strokeWidth={1.5} />
        </Animated.View>

        <Animated.Text style={[styles.title, titleStyle]}>
          Account Created
        </Animated.Text>

        <Animated.Text style={[styles.subtitle, subtitleStyle]}>
          You're all set. Taking you to sign in…
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000000' },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 40,
  },
  iconWrap: {
    marginBottom: 8,
  },
  title: {
    fontSize: 28,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
    textAlign: 'center',
    lineHeight: 24,
  },
});
