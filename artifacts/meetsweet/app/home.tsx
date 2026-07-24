import React, { useEffect } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { router } from 'expo-router';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { T } from '@/constants/theme';

export default function HomeTransition() {
  const containerOpacity = useSharedValue(0);
  const containerScale = useSharedValue(0.94);

  const navigate = () => router.replace('/(tabs)');

  useEffect(() => {
    containerOpacity.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });
    containerScale.value = withTiming(1, { duration: 360, easing: Easing.out(Easing.cubic) });

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
        <Spinner size="sm" color="#FFFFFF" style={styles.spinner} />
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
  spinner: { marginTop: 28 },
});
