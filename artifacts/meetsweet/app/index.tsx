import React, { useEffect } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Spinner } from 'heroui-native';
import { router } from 'expo-router';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

const VERSION = '1.0.0';

export default function SplashScreen() {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0.88);
  const spinnerOpacity = useSharedValue(0);
  const versionOpacity = useSharedValue(0);

  const navigate = () => router.replace('/welcome');

  useEffect(() => {
    opacity.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    scale.value = withTiming(1, { duration: 520, easing: Easing.out(Easing.cubic) });
    spinnerOpacity.value = withDelay(480, withTiming(1, { duration: 280 }));
    versionOpacity.value = withDelay(600, withTiming(1, { duration: 280 }));

    const timer = setTimeout(() => {
      opacity.value = withTiming(
        0,
        { duration: 260, easing: Easing.in(Easing.cubic) },
        (done) => { if (done) runOnJS(navigate)(); },
      );
    }, 2400);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }],
  }));
  const spinnerStyle = useAnimatedStyle(() => ({ opacity: spinnerOpacity.value }));
  const versionStyle = useAnimatedStyle(() => ({ opacity: versionOpacity.value }));

  return (
    <View style={styles.bg}>
      <View style={styles.center}>
        <Animated.View style={[styles.logoContainer, logoStyle]}>
          <Image
            source={require('../assets/images/logo.png')}
            style={styles.logo}
            resizeMode="contain"
            tintColor="#FFFFFF"
          />
          <Text style={styles.appName}>MeetSweet</Text>
          <Text style={styles.tagline}>Where creators meet their community</Text>
        </Animated.View>

        <Animated.View style={[styles.spinnerWrap, spinnerStyle]}>
          <Spinner size="sm" color="#FFFFFF" />
        </Animated.View>
      </View>

      <Animated.View style={[styles.versionWrap, versionStyle]}>
        <Text style={styles.version}>v{VERSION}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
    paddingBottom: Platform.OS === 'web' ? 80 : 40,
  },
  logoContainer: {
    alignItems: 'center',
    gap: 14,
  },
  logo: {
    width: 64,
    height: 64,
  },
  appName: {
    fontSize: 34,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  tagline: {
    fontSize: 14,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.4)',
    letterSpacing: 0.2,
  },
  spinnerWrap: {
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  versionWrap: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 48 : 36,
    alignSelf: 'center',
  },
  version: {
    fontSize: 12,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.2)',
    letterSpacing: 0.5,
  },
});
