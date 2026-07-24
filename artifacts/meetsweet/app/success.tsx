import React, { useEffect } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Button } from 'heroui-native';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Path, Defs, RadialGradient, Stop } from 'react-native-svg';

// ─── Check icon ───────────────────────────────────────────────────────────────

function SuccessIcon() {
  return (
    <Svg width={140} height={140} viewBox="0 0 140 140">
      <Defs>
        <RadialGradient id="glow" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#22C55E" stopOpacity="0.25" />
          <Stop offset="100%" stopColor="#22C55E" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* Glow */}
      <Circle cx="70" cy="70" r="68" fill="url(#glow)" />
      {/* Ring */}
      <Circle cx="70" cy="70" r="52" fill="#111111" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
      {/* Checkmark */}
      <Path
        d="M48 72 L62 86 L94 56"
        stroke="#22C55E"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

// ─── Particle ─────────────────────────────────────────────────────────────────

function Particle({ angle, delay }: { angle: number; delay: number }) {
  const rad = (angle * Math.PI) / 180;
  const tx = Math.cos(rad) * 76;
  const ty = Math.sin(rad) * 76;
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(0);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withSequence(
        withTiming(1, { duration: 180 }),
        withDelay(280, withTiming(0, { duration: 380 })),
      ),
    );
    translateX.value = withDelay(delay, withTiming(tx, { duration: 680, easing: Easing.out(Easing.cubic) }));
    translateY.value = withDelay(delay, withTiming(ty, { duration: 680, easing: Easing.out(Easing.cubic) }));
    scale.value = withDelay(
      delay,
      withSequence(
        withTiming(1.2, { duration: 200 }),
        withTiming(0.6, { duration: 480 }),
      ),
    );
  }, []);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  // White-spectrum particles only
  const colors = ['#FFFFFF', 'rgba(255,255,255,0.7)', 'rgba(255,255,255,0.5)', '#22C55E'];
  const color = colors[Math.floor(angle / 90) % colors.length];

  return (
    <Animated.View style={[styles.particle, { backgroundColor: color }, style]} />
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

const PARTICLE_ANGLES = [0, 40, 80, 130, 180, 220, 270, 320];

export default function SuccessScreen() {
  const insets = useSafeAreaInsets();

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const titleOpacity = useSharedValue(0);
  const titleY = useSharedValue(20);
  const subtitleOpacity = useSharedValue(0);
  const btnOpacity = useSharedValue(0);
  const btnY = useSharedValue(20);

  useEffect(() => {
    iconOpacity.value = withTiming(1, { duration: 280 });
    iconScale.value = withSequence(
      withSpring(1.15, { damping: 7, stiffness: 200 }),
      withSpring(1, { damping: 12, stiffness: 300 }),
    );
    titleOpacity.value = withDelay(380, withTiming(1, { duration: 380 }));
    titleY.value = withDelay(380, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));
    subtitleOpacity.value = withDelay(560, withTiming(1, { duration: 380 }));
    btnOpacity.value = withDelay(740, withTiming(1, { duration: 380 }));
    btnY.value = withDelay(740, withTiming(0, { duration: 380, easing: Easing.out(Easing.cubic) }));
  }, []);

  const iconStyle = useAnimatedStyle(() => ({
    opacity: iconOpacity.value,
    transform: [{ scale: iconScale.value }],
  }));
  const titleStyle = useAnimatedStyle(() => ({
    opacity: titleOpacity.value,
    transform: [{ translateY: titleY.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
  }));
  const btnStyle = useAnimatedStyle(() => ({
    opacity: btnOpacity.value,
    transform: [{ translateY: btnY.value }],
  }));

  return (
    <View style={styles.bg}>
      <View
        style={[
          styles.container,
          {
            paddingTop: insets.top + (Platform.OS === 'web' ? 80 : 40),
            paddingBottom: insets.bottom + (Platform.OS === 'web' ? 60 : 48),
          },
        ]}
      >
        {/* Icon + particles */}
        <View style={styles.iconSection}>
          <View style={styles.particleOrigin} pointerEvents="none">
            {PARTICLE_ANGLES.map((angle, i) => (
              <Particle key={angle} angle={angle} delay={180 + i * 38} />
            ))}
          </View>
          <Animated.View style={iconStyle}>
            <SuccessIcon />
          </Animated.View>
        </View>

        {/* Text */}
        <View style={styles.textSection}>
          <Animated.Text style={[styles.title, titleStyle]}>
            You're all set!
          </Animated.Text>
          <Animated.Text style={[styles.subtitle, subtitleStyle]}>
            Welcome to MeetSweet. Your account is verified and ready. Discover creators and exclusive communities waiting for you.
          </Animated.Text>
        </View>

        {/* CTA */}
        <Animated.View style={[styles.btnWrap, btnStyle]}>
          <Button
            variant="primary"
            size="lg"
            onPress={() => router.replace('/auth')}
            style={styles.btn}
          >
            <Button.Label style={styles.btnLabel}>Sign In to MeetSweet</Button.Label>
          </Button>
        </Animated.View>
      </View>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: '#000000' },
  container: {
    flex: 1,
    paddingHorizontal: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 40,
  },
  iconSection: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  particleOrigin: {
    position: 'absolute',
    width: 0,
    height: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  particle: {
    position: 'absolute',
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  textSection: {
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 8,
  },
  title: {
    fontSize: 32,
    fontFamily: 'Poppins_700Bold',
    color: '#FFFFFF',
    textAlign: 'center',
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 15,
    fontFamily: 'Poppins_400Regular',
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    lineHeight: 24,
  },
  btnWrap: {
    width: '100%',
  },
  btn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 46,
  },
  btnLabel: {
    fontFamily: 'Poppins_600SemiBold',
    fontSize: 15,
    color: '#000000',
  },
});
