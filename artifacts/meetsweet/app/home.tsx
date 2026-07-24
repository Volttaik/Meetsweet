import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { T } from '@/constants/theme';

export default function HomeTransition() {
  const containerOpacity = useSharedValue(0);
  const containerScale = useSharedValue(0.94);
  const d1 = useSharedValue(0.15);
  const d2 = useSharedValue(0.15);
  const d3 = useSharedValue(0.15);

  const navigate = () => router.replace('/(tabs)');

  useEffect(() => {
    containerOpacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    containerScale.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });

    const pulse = withRepeat(
      withSequence(
        withTiming(1, { duration: 380 }),
        withTiming(0.15, { duration: 380 }),
      ),
      -1,
      false,
    );
    d1.value = withDelay(400, pulse);
    d2.value = withDelay(580, pulse);
    d3.value = withDelay(760, pulse);

    const t = setTimeout(() => {
      containerOpacity.value = withTiming(
        0,
        { duration: 280, easing: Easing.in(Easing.cubic) },
        (done) => { if (done) runOnJS(navigate)(); },
      );
    }, 1600);

    return () => clearTimeout(t);
  }, []);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: containerOpacity.value,
    transform: [{ scale: containerScale.value }],
  }));
  const dot1 = useAnimatedStyle(() => ({ opacity: d1.value }));
  const dot2 = useAnimatedStyle(() => ({ opacity: d2.value }));
  const dot3 = useAnimatedStyle(() => ({ opacity: d3.value }));

  return (
    <View style={styles.bg}>
      <Animated.View style={[styles.center, containerStyle]}>
        <Image
          source={require('../assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
          tintColor="#FFFFFF"
        />
        <Text style={styles.appName}>MeetSweet</Text>
        <Text style={styles.subtitle}>Preparing your feed…</Text>
        <View style={styles.dots}>
          <Animated.View style={[styles.dot, dot1]} />
          <Animated.View style={[styles.dot, dot2]} />
          <Animated.View style={[styles.dot, dot3]} />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: T.BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { alignItems: 'center', gap: 10 },
  logo: { width: 56, height: 56, marginBottom: 8 },
  appName: {
    fontSize: 27,
    fontFamily: T.FONT.bold,
    color: T.TEXT,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    fontFamily: T.FONT.regular,
    color: T.TEXT_2,
    marginTop: 2,
  },
  dots: { flexDirection: 'row', gap: 8, marginTop: 28 },
  dot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: T.TEXT },
});
